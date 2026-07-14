#!/usr/bin/env python3
import base64
import datetime as dt
import hashlib
import math
import pathlib
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID


RSA_PUBLIC_EXPONENT = 65537
RSA_KEY_SIZE = 4096
RSA_PRIME_BITS = RSA_KEY_SIZE // 2
MILLER_RABIN_ROUNDS = 64
SMALL_PRIMES = (
    3,
    5,
    7,
    11,
    13,
    17,
    19,
    23,
    29,
    31,
    37,
    41,
    43,
    47,
    53,
    59,
    61,
    67,
    71,
    73,
    79,
    83,
    89,
    97,
)


def secret(label: str, password: str) -> bytes:
    return hashlib.sha256(f"v7-practice:{label}:{password}".encode("utf-8")).digest()


def secret_stream(label: str, password: str, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(secret(f"{label}:{counter}", password))
        counter += 1
    return bytes(output[:length])


def printable_secret(label: str, password: str) -> str:
    return base64.urlsafe_b64encode(secret(label, password)).decode("ascii").rstrip("=")


def deterministic_int(label: str, password: str, minimum: int, maximum: int) -> int:
    span = maximum - minimum + 1
    size = (span.bit_length() + 7) // 8
    value = int.from_bytes(secret_stream(label, password, size + 8), "big")
    return minimum + (value % span)


def prime_candidate(label: str, password: str, bits: int) -> int:
    size = (bits + 7) // 8
    candidate = int.from_bytes(secret_stream(label, password, size), "big")
    candidate |= 1
    candidate |= 1 << (bits - 1)
    candidate &= (1 << bits) - 1
    return candidate


def is_probable_prime(value: int, password: str, label: str) -> bool:
    if value < 2:
        return False
    for prime in SMALL_PRIMES:
        if value == prime:
            return True
        if value % prime == 0:
            return False

    d = value - 1
    s = 0
    while d % 2 == 0:
        s += 1
        d //= 2

    for round_index in range(MILLER_RABIN_ROUNDS):
        base = deterministic_int(
            f"miller-rabin:{label}:{round_index}",
            password,
            2,
            value - 2,
        )
        x = pow(base, d, value)
        if x == 1 or x == value - 1:
            continue
        for _ in range(s - 1):
            x = pow(x, 2, value)
            if x == value - 1:
                break
        else:
            return False
    return True


def derive_prime(label: str, password: str, bits: int) -> int:
    candidate = prime_candidate(label, password, bits)
    attempt = 0
    while True:
        current = candidate + (attempt * 2)
        if current.bit_length() != bits:
            candidate = prime_candidate(f"{label}:retry:{attempt}", password, bits)
            attempt = 0
            continue
        if math.gcd(current - 1, RSA_PUBLIC_EXPONENT) == 1 and is_probable_prime(
            current,
            password,
            f"{label}:{attempt}",
        ):
            return current
        attempt += 1


def derive_rsa_private_key(password: str) -> rsa.RSAPrivateKey:
    p = derive_prime("rsa-prime-p", password, RSA_PRIME_BITS)
    q = derive_prime("rsa-prime-q", password, RSA_PRIME_BITS)
    retry = 0
    while p == q:
        q = derive_prime(f"rsa-prime-q-retry:{retry}", password, RSA_PRIME_BITS)
        retry += 1

    if p < q:
        p, q = q, p

    n = p * q
    phi = (p - 1) * (q - 1)
    d = pow(RSA_PUBLIC_EXPONENT, -1, phi)
    dmp1 = d % (p - 1)
    dmq1 = d % (q - 1)
    iqmp = pow(q, -1, p)

    public_numbers = rsa.RSAPublicNumbers(RSA_PUBLIC_EXPONENT, n)
    private_numbers = rsa.RSAPrivateNumbers(
        p=p,
        q=q,
        d=d,
        dmp1=dmp1,
        dmq1=dmq1,
        iqmp=iqmp,
        public_numbers=public_numbers,
    )
    return private_numbers.private_key()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: derive-v7-practice-keystore.py <output.p12>", file=sys.stderr)
        return 2

    password = sys.stdin.read()
    if not password:
        print("signing password is required on stdin", file=sys.stderr)
        return 2

    output = pathlib.Path(sys.argv[1])
    private_key = derive_rsa_private_key(password)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "V7 Practice"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "V7"),
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        ]
    )
    certificate_not_valid_before = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
    certificate_not_valid_after = dt.datetime(2054, 1, 1, tzinfo=dt.timezone.utc)
    serial_number = int.from_bytes(secret("certificate-serial", password)[:20], "big") >> 1
    if serial_number == 0:
        serial_number = 1
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(serial_number)
        .not_valid_before(certificate_not_valid_before)
        .not_valid_after(certificate_not_valid_after)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    store_password = printable_secret("store-password", password)
    p12 = pkcs12.serialize_key_and_certificates(
        name=b"v7-practice",
        key=private_key,
        cert=certificate,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(store_password.encode("utf-8")),
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(p12)
    output.chmod(0o600)

    print(f"SIGNING_STORE_PASSWORD={store_password}")
    print(f"SIGNING_KEY_PASSWORD={store_password}")
    print("SIGNING_KEY_ALIAS=v7-practice")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import base64
import datetime as dt
import hashlib
import pathlib
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID


P256_ORDER = int("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)


def secret(label: str, password: str) -> bytes:
    return hashlib.sha256(f"v7-practice:{label}:{password}".encode("utf-8")).digest()


def printable_secret(label: str, password: str) -> str:
    return base64.urlsafe_b64encode(secret(label, password)).decode("ascii").rstrip("=")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: derive-v7-practice-keystore.py <output.p12>", file=sys.stderr)
        return 2

    password = sys.stdin.read()
    if not password:
        print("signing password is required on stdin", file=sys.stderr)
        return 2

    output = pathlib.Path(sys.argv[1])
    private_value = (int.from_bytes(secret("p256-private-key", password), "big") % (P256_ORDER - 1)) + 1
    private_key = ec.derive_private_key(private_value, ec.SECP256R1())

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "V7 Practice"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "V7"),
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        ]
    )
    now = dt.datetime.now(dt.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(int.from_bytes(secret("certificate-serial", password)[:20], "big") >> 1)
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=365 * 30))
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

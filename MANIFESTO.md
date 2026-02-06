# Stripped Plover integration

**NOTE:** for copyright reasons, DO NOT INCLUDE Stripped Plover code in this repository. Instead, just modify docker-compose.yml or Dockerfile to clone the Stripped Plover repository. In fact, Stripped Plover should run as a separate container in Docker Compose.

**Communication flow:**

Inference backend communicates with Stripped Plover over TCP. As Stripped Plover doesn't speak TCP, some netcat technique can be used to proxy Stripped Plover STDIO communications over TCP.

If Stripped Plover is disabled, the inference backend still runs normally, but features dependent on Stripped Plover are disabled.

**What is the role of Stripped Plover?**


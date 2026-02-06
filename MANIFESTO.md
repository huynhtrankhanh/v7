# Stripped Plover integration

**NOTE:** for copyright reasons, DO NOT INCLUDE Stripped Plover code in this repository. Instead, just modify docker-compose.yml or Dockerfile to clone the Stripped Plover repository. In fact, Stripped Plover should run as a separate container in Docker Compose.

**Communication flow:**

Inference backend communicates with Stripped Plover over TCP. As Stripped Plover doesn't speak TCP, some netcat technique can be used to proxy Stripped Plover STDIO communications over TCP.

If Stripped Plover is disabled, the inference backend still runs normally, but features dependent on Stripped Plover are disabled.

**What is the role of Stripped Plover?**

To facilitate the input of words not covered by the existing input methods in the frontend (one syllable, two partially specified syllables, Emily's symbols, capital letters, numbers).

Text inputted by Stripped Plover is to be treated as being of island "vietnamese".

**When is a stroke passed to Stripped Plover?**

The frontend keeps track of a new flag:

*Is Stripped Plover the preferred mode?* (stripped_plover)

Two cases.
* When stripped_plover is false: If a stroke is not recognized by existing methods, it is passed to Stripped Plover. The translation is done for this single stroke, and reset_state is called over RPC. This means the translation is a one-time thing only.
* When stripped_plover is true: all strokes are passed to Stripped Plover and affect the translation of the island. Then, when stripped_plover becomes false, reset_state is called over RPC. This commits the island and we can input subsequent text in the usual mode.

Stripped Plover refers to https://github.com/huynhtrankhanh/strippedplover

stripped_plover defaults to false. The mode toggles when the # (QWERTY Q) key is pressed.

# Stripped Plover integration

**NEW REQUIREMENTS:**
The specification has been implemented, but imperfectly.
* RPC calls being over HTTP means the intermediary server has to buffer too much data. Use WebSocket instead.
* Each WebSocket client spawns a new Stripped Plover process.
* **RULES PERTAINING TO UNDO:**
  * When Plover mode is enabled, all undo commands are forwarded to Plover
  * When Plover mode is disabled:
    * As the frontend has no awareness of the internal state of Plover, it can only treat the whole text inserted by Plover as a unified block, and undo deletes the whole block.
* It is important to not do any sort of space trimming on the raw text provided by Plover.
* Thoroughly test the application end to end, using JSDom or Puppeteer. Test the new features.
* When a text box belonging to the dictionary management section is focused, input capture is temporarily paused to enable the user to type text in the textbox.

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

**Dictionary management**

UI for dictionary management needs to be implemented in the frontend. This includes deleting dictionaries and adding dictionaries by upload, and modifying individual entries.

**Persistence of Stripped Plover dictionary database**

It has to persist on a Docker volume.

**UTMOST REQUIREMENT:** when Stripped Plover container is deleted from Docker Compose, the code still functions normally, just that Stripped Plover features are disabled.

**Test the code thoroughly!**

**To test the backend, use the Mocked Model mode. This alone is enough.**

# Stripped Display Mode of Web UI
In the stripped display mode:
* Only the rightmost 9 Vietnamese syllables are visible. Non-Vietnamese segments in between are to be handled as follows:
  * If the segment just consists of one to three characters (for example, punctuation, numbers), leave the segment as is.
  * Beyond that, replace the segment with an ellipsis.
* Candidates: If there are no candidates, do not even display the candidate display. If there are candidates, do not show the first choice, which just says *current* anyway.
* **Stripped Plover status and management:**

The stripped display mode can be triggered by calling window.setStrippedDisplay().

# Stripped Display Mode of Web UI
In the stripped display mode:
* Only the rightmost 9 Vietnamese syllables are visible. Non-Vietnamese segments in between are to be handled as follows:
  * If the segment just consists of one to three characters (for example, punctuation, numbers), leave the segment as is.
  * Beyond that, replace the segment with an ellipsis.
* Candidates: If there are no candidates, do not even display the candidate display. If there are candidates, do not show the first choice, which just says *current* anyway.
* **Stripped Plover status and management:**
  * If Stripped Plover mode is enabled, the UI goes blank entirely. The background color turns yellow.
  * Otherwise, the UI shouldn't display anything related to Stripped Plover.
* Escape hatch (raw text mode) is not allowed.
* If copy is allowed, Ctrl+C still copies the entire text buffer.

The stripped display mode can be triggered by calling window.setStrippedDisplay({ copyAllowed: true }).

Test and document the feature.

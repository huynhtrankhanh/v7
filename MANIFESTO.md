# Stripped Plover management and UI
* This affects: **Android IME**
* Bump Stripped Plover
* Now it emits 3 events: lookup, add translation, configure
  * Lookup: display native popup to look up entries. lookup results should clearly show from which dictionary an entry is
  * Add translation:
    * also native popup to add new translation while choosing the dictionary to add the translation to
    * native popup details
      * in the stroke input the IME should switch to some "raw outline mode" where strokes are joined by / to form an outline. this requires some input field marking and IME coordination. and the IME should show a thin bar saying "Raw outline mode"
      * in the translation input the IME is in the ordinary mode where user can type v7, Emily, stripped plover etc
  * Configure: user is to be taken straight to V7 IME settings activity
* Dictionary management screen:
  * Remove the top bar, it causes all sorts of layout problems for the inside WebView. the WebView should just occupy the entire real estate available
  * Allow the user to create a new blank JSON dictionary. the user doesn't have to upload anything to create that blank dictionary
 
Test, document, commit, push to main

# Task 1
* This affects: **Android IME**, native popups
* When the user hits Enter on the keyboard, the popup form should be submitted
# Task 2
* This **creates a new subsystem**
* The subsystem's purpose is to enable the user to learn how to use the IME
* To properly implement the subsystem, you must investigate the entire IME codebase
* The subsystem teaches IME principles in Vietnamese
* The subsystem is web based
* The subsystem requires the use of an external keyboard
* Prior to "enrollment", the subsystem checks if the user truly has an NKRO keyboard by asking the user to **chord specific keys**
* The subsystem uses FSRS retention model to adaptively tailor lessons to reinforce IME concepts
* The subsystem has very detailed tracking, including keystroke logging within the website, mouse tracking, click tracking, screenshotting (HTML DOM level, do not render because that'd be dangerous to space, viewport recorded)
* The user has to consent to **detailed data logging** prior to being enrolled
* The system has a backend
* No one can voluntarily sign up for the website. Accounts have to be created manually on the database.
* Prior to signing in or consent, no tracking takes place
* The backing database is SQLite
* For lessons involving the predictive model, **backend inference** is used
* Stripped Plover is not covered by the lessons
* Backend must not launch Stripped Plover
* Document the feature thoroughly

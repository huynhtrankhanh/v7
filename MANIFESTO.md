**Wow, we have such a fascinating repository!**

But the repository is also full of fluff. It is a fork of the v7 repository by Nguyễn Phan Trí Đức, but as the repository evolved, the code that is actually being run is no longer a direct derivative of the original code. The general idea lives on, but most of the original code was already deleted.

This is now a cleanup effort.

* Delete the archive_scripts and the checkpoints, tests, utils folder
* Move generated_regexes.json out of the ai folder and delete the ai folder
* Delete all Python files except preprocess_corpus.py
* Delete all .md files except README_KENLM.md and MANIFESTO.md
* Write a new README.md that explains how the system works, and the input format
* If the remaining code still depends on the deleted files, in the Pull Request description please say so
* You don't have to test the code. This is just cleanup work.

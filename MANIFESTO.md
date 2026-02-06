# Single Syllable Layout Reform
**NOTE:** This is a frontend change, and does not affect backend. README_WEB.md has to be updated to reflect the new changes.

This change affects how the final of a syllable is inputted. Currently the mapping is:

```js
const finalMap = {
    "FP": "j", "F": "w", "P": "p", "R": "t", "FR": "c", "RB": "ch",
    "PB": "nh", "L": "n", "PL": "m", "B": "ng",
};

const toneMap = {
    "T": "sắc", "S": "huyền", "G": "hỏi", "TS": "ngã", "GS": "nặng",
};
```

I propose this change:

```js
const finalMap = {
    "FP": "j", "F": "w", "P": "m", "R": "n", "FR": "ng", "RP": "nh"
};

const toneMap = {
    "L": "sắc", "G": "huyền", "B": "hỏi", "LG": "ngã", "BG": "nặng", "BL": "ách", "BLG": "ạch"
};
```

With these rules:

"P" + "BL"/"BLG" = final "p", tone "sắc"/"nặng"
"R" + "BL"/"BLG" = final "t", tone "sắc"/"nặng"
"FR" + "BL"/"BLG" = final "c", tone "sắc"/"nặng"
"RP" + "BL"/"BLG" = final "ch", tone "sắc"/"nặng"

"F" and "FP" can't be combined with "BL"/"BLG", these combinations are considered illegal.

Update documentation to reflect these changes.

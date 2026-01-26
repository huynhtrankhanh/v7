# Islands and Spacing

**Note:** This feature only affects the frontend. The backend is not affected.

On the server, the notion of islands is rather limited. An island is either a fixed text island or a v7 island.

Currently, the client also shares the same conception of islands. But now, as there are new features, the island types on the client should be different from the island types on the server. There can still be a conversion function before sending the buffer to the server for inference.

But islands on the client affect **spacing**.

So now we should have these island types:
* Vietnamese islands:
  * Whole syllables
  * v7 partially specified syllable pairs
* Punctuation islands: period, comma, exclamation mark, question mark. **To prevent double spacing, these punctuation islands don't come pre-packaged with a space right after the punctuation mark. Rather, spacing will be determined by spacing rules.**
* Capital letter islands: literal capital letters inserted by Shift held down together with the letter key
* Spacing islands: both newline and space

By having these island types, we can have fine grained control over spacing.

Now here are the spacing rules:

* Capital letter islands sitting next to each other should have no space between them. A capital letter island sitting after a spacing island should have no additional space to separate, so as to prevent double spacing. If it sits after a Vietnamese island or a punctuation island, there should be a space in between.
* Punctuation islands: When sitting after other island types, there should be no space in between. Other island types when sitting after punctuation islands generally choose to put a space in between, **except spacing islands, which already provide spacing on their own and as such do not warrant additional separating space.**
* Spacing islands sitting together should have no space in between.

You get the general tenor. I haven't specified all the rules. But you are to modify the frontend code to implement these islands, and sensible spacing rules, and then document them in README_WEB.md. The goal is to prevent unnecessary double spacing.

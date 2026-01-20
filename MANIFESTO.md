**inference-rs and Plover integration:**

**Executive summary:** Plover and inference-rs run in two separate processes, so any communication between the two must be through an inter-process communication channel. Our communication mechanism here is through STDIO. inference-rs provides an STDIO interface just for Plover to interact with.

**Scripting Plover:** The main mechanism of scripting in Plover is **Python programmatic dictionaries**. These dictionaries are not sandboxed or restrained in any way. This is a security disaster, but it's also very useful for our purposes.

**The anatomy of a programmatic dictionary**

```python
LONGEST_KEY = 998244353

def lookup(outline):
  pass
```

We need to first understand how Plover looks up outlines in a dictionary.

#!/usr/bin/env python3
"""Generate phrase anagrams for every capital into data/anagrams.json.

Needs the `wordfreq` package (python3 -m pip install wordfreq) and the
system word list in /usr/share/dict/american-english, which filters out
names and abbreviations that wordfreq's list contains.

Output: {country id: ["WORD WORD", ...]} best first; capitals without a
decent phrase get an empty list and the app falls back to a letter shuffle.
"""
import json
import pathlib
import time
import unicodedata
import urllib.request

from wordfreq import top_n_list, zipf_frequency

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
BLOCKLIST_URL = ("https://raw.githubusercontent.com/LDNOOBW/"
                 "List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en")

SHORT_OK = {"a", "i", "an", "am", "as", "at", "be", "by", "do", "go", "he", "if",
            "in", "is", "it", "me", "my", "no", "of", "oh", "on", "or", "so",
            "to", "up", "us", "we", "ox", "ah", "ha", "hi"}
EXTRA_BLOCK = {"nazi", "nazis", "rape", "raped", "rapist", "slut", "whore", "negro",
               "retard", "retarded", "jihad", "suicide", "cocaine", "heroin",
               "ho", "hos", "gay", "homo", "jew", "jews",
               # abbreviations, slang spellings and names that read as noise
               "ani", "lbs", "vii", "viii", "viz", "var", "mos", "nite", "hogan", "lam",
               "dun", "sol", "lib", "gonna", "wanna", "gotta", "yea", "nay", "cos",
               "ave", "ante", "ops", "sis", "bro", "info", "apps", "des", "est", "ist"}
MIN_ZIPF = 3.0
MAX_RESULTS = 6
TIME_LIMIT = 6.0


def letters(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in s.lower() if "a" <= ch <= "z")


def counts(w):
    c = [0] * 26
    for ch in w:
        c[ord(ch) - 97] += 1
    return c


def vocabulary():
    cache = HERE / ".cache" / "blocklist.txt"
    if not cache.exists():
        cache.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(BLOCKLIST_URL, cache)
    block = {w.strip() for w in cache.read_text().split("\n")} | EXTRA_BLOCK
    dictionary = {w.strip() for w in open("/usr/share/dict/american-english")
                  if w.strip().isalpha() and w.strip().islower()}
    vocab = {}
    for w in top_n_list("en", 60000):
        if not (w.isascii() and w.isalpha()) or w in block or w not in dictionary:
            continue
        if len(w) <= 2 and w not in SHORT_OK:
            continue
        z = zipf_frequency(w, "en")
        if z >= MIN_ZIPF:
            vocab[w] = z
    return vocab


def score(words, vocab):
    zs = [vocab[w] for w in words]
    tiny = sum(len(w) <= 2 for w in words)
    return 0.6 * min(zs) + 0.4 * sum(zs) / len(zs) - 0.9 * len(words) - 0.6 * tiny


def solve(target, banned, vocab):
    need = counts(target)
    max_words = 3 if len(target) <= 9 else 4 if len(target) <= 14 else 5
    cands = []
    for w in vocab:
        if w in banned or any(w in b or b in w for b in banned if len(b) >= 4):
            continue
        c = counts(w)
        if all(c[i] <= need[i] for i in range(26)):
            cands.append((w, c))
    cands.sort(key=lambda x: -len(x[0]))

    found = []
    deadline = time.time() + TIME_LIMIT

    def dfs(start, remaining, left, chosen):
        if left == 0:
            found.append(tuple(chosen))
            return
        if len(chosen) == max_words or time.time() > deadline or len(found) > 50000:
            return
        for i in range(start, len(cands)):
            w, c = cands[i]
            if len(w) > left:
                continue
            if len(chosen) == max_words - 1 and len(w) != left:
                continue
            if all(c[k] <= remaining[k] for k in range(26)):
                for k in range(26):
                    remaining[k] -= c[k]
                chosen.append(w)
                dfs(i, remaining, left - len(w), chosen)
                chosen.pop()
                for k in range(26):
                    remaining[k] += c[k]

    dfs(0, need[:], len(target), [])
    return found


def pick(found, vocab):
    ranked = sorted(set(found), key=lambda ws: -score(ws, vocab))
    picked = []
    for ws in ranked:
        if score(ws, vocab) < 0.5:
            break
        # keep the list varied: skip phrases that reuse a word already picked
        if any(set(ws) & set(p) for p in picked):
            continue
        picked.append(ws)
        if len(picked) == MAX_RESULTS:
            break
    return [" ".join(sorted(ws, key=len, reverse=True)).upper() for ws in picked]


def main():
    countries = json.loads((DATA / "countries.json").read_text())
    vocab = vocabulary()
    print(f"{len(vocab)} words")
    out = {}
    for c in countries:
        target = letters(c["capital"].split(",")[0])  # "Washington, D.C." -> Washington
        banned = {letters(p) for p in c["capital"].split()} | {letters(c["name"])}
        banned |= {letters(p) for p in c["name"].split()}
        banned.discard("")
        phrases = pick(solve(target, banned, vocab), vocab)
        out[c["id"]] = phrases
        print(f"{c['capital']:28} {' | '.join(phrases[:3])}")
    (DATA / "anagrams.json").write_text(json.dumps(out, indent=0) + "\n")
    print(f"{sum(bool(v) for v in out.values())}/{len(out)} capitals have phrases")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build data/countries.json (195 countries).

Sources (downloaded into tools/.cache on first run):
  - mledoze/countries           names, capitals, regions, ISO codes
  - Natural Earth populated places   capital coordinates
Pub-quiz conventions (English names, accepted alternatives, notes) are the
OVERRIDES below.
"""
import json
import pathlib
import urllib.request

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
OUT = HERE.parent / "data" / "countries.json"

SOURCES = {
    "countries.json": "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
    "places.json": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
}

INCLUDE = {"UNK", "TWN"}
EXCLUDE = {"VAT"}  # mledoze marks the Vatican as a member; it is an observer

# name: display name, aliases: other accepted country names,
# capital: primary capital, alt: other accepted answers, note: shown on reveal
OVERRIDES = {
    "ATG": {"capital": "St. John's"},
    "BHS": {"name": "The Bahamas", "aliases": ["Bahamas"]},
    "BEN": {"note": "Cotonou is the seat of government."},
    "BOL": {"alt": ["La Paz"], "note": "Sucre is the constitutional capital; La Paz is the seat of government."},
    "CIV": {"aliases": ["Côte d'Ivoire", "Cote d'Ivoire"], "note": "Abidjan is the largest city and former capital."},
    "COD": {"name": "DR Congo", "aliases": ["Democratic Republic of the Congo", "Congo-Kinshasa", "DRC", "Zaire"]},
    "COG": {"name": "Republic of the Congo", "aliases": ["Congo", "Congo-Brazzaville"]},
    "CPV": {"aliases": ["Cabo Verde"]},
    "CZE": {"aliases": ["Czech Republic"]},
    "GMB": {"name": "The Gambia", "aliases": ["Gambia"]},
    "GRD": {"capital": "St. George's"},
    "IND": {"alt": ["Delhi"]},
    "KAZ": {"alt": ["Nur-Sultan"], "note": "Called Nur-Sultan from 2019 to 2022."},
    "KIR": {"alt": ["Tarawa"]},
    "LKA": {"alt": ["Sri Jayawardenepura Kotte", "Kotte"], "note": "Sri Jayawardenepura Kotte is the legislative capital."},
    "MDA": {"alt": ["Kishinev"]},
    "MKD": {"aliases": ["Macedonia"]},
    "MMR": {"alt": ["Nay Pyi Taw", "Naypyitaw"], "aliases": ["Burma"], "note": "Yangon (Rangoon) was the capital until 2006."},
    "MNG": {"capital": "Ulaanbaatar", "alt": ["Ulan Bator"]},
    "MYS": {"note": "Putrajaya is the administrative centre."},
    "NLD": {"note": "The Hague is the seat of government."},
    "NRU": {"note": "Nauru has no official capital; government offices are in Yaren."},
    "PLW": {"note": "Replaced Koror as capital in 2006."},
    "PRK": {"aliases": ["DPRK"]},
    "SMR": {"capital": "San Marino", "alt": ["City of San Marino"]},
    "STP": {"name": "São Tomé and Príncipe", "aliases": ["Sao Tome and Principe"]},
    "SWZ": {"capital": "Mbabane", "alt": ["Lobamba"], "aliases": ["Swaziland"], "note": "Mbabane is the executive capital; Lobamba the royal and legislative capital."},
    "TLS": {"name": "East Timor", "aliases": ["Timor-Leste"]},
    "TKM": {"alt": ["Ashkhabad"]},
    "TUR": {"name": "Turkey", "aliases": ["Türkiye", "Turkiye"]},
    "TZA": {"note": "Dar es Salaam was the capital until 1996 and is still the largest city."},
    "UKR": {"alt": ["Kiev"]},
    "UNK": {"alt": ["Prishtina"]},
    "USA": {"capital": "Washington, D.C.", "alt": ["Washington"], "aliases": ["USA", "United States of America", "America"]},
    "GBR": {"aliases": ["UK", "Great Britain", "Britain"]},
    "ARE": {"aliases": ["UAE"]},
    "CAF": {"aliases": ["CAR"]},
    "ZAF": {"note": "Pretoria is the executive capital, Cape Town the legislative and Bloemfontein the judicial capital."},
    "CHE": {"alt": ["Berne"]},
    "YEM": {"alt": ["Sanaa"]},
    "BDI": {"note": "Bujumbura was the capital until 2019."},
    "CYP": {"alt": ["Lefkosia"]},
    "FSM": {"aliases": ["Federated States of Micronesia"]},
    "VCT": {"aliases": ["St. Vincent and the Grenadines"]},
    "KNA": {"aliases": ["St. Kitts and Nevis"]},
    "LCA": {"aliases": ["St. Lucia"]},
}

# Natural Earth uses a few different codes than ISO/mledoze.
NE_CODE = {"UNK": "KOS"}
# ...and a few local or short names for capitals
NE_NAME = {"AND": "Andorra", "DNK": "København"}

# Capitals Natural Earth lacks or places under an old name: (lat, lon)
COORDS = {
    "BDI": (-3.4271, 29.9246),   # Gitega
    "PLW": (7.5006, 134.6242),   # Ngerulmud
    "NRU": (-0.5477, 166.9209),  # Yaren
    "KAZ": (51.1694, 71.4491),   # Astana
}

# Continent buckets used by the region filter
def continent(c):
    region, sub = c["region"], c["subregion"]
    if region == "Americas":
        return "South America" if sub == "South America" else "North America"
    return region


def fetch(name):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print("downloading", SOURCES[name])
        urllib.request.urlretrieve(SOURCES[name], path)
    return json.loads(path.read_text())


def norm(s):
    import unicodedata
    s = unicodedata.normalize("NFD", s).replace("St. ", "Saint ")
    return "".join(ch for ch in s if ch.isalnum()).lower()


def main():
    countries = fetch("countries.json")
    places = [f["properties"] for f in fetch("places.json")["features"]]

    out, missing = [], []
    for c in countries:
        code = c["cca3"]
        if code in EXCLUDE or not (c.get("unMember") or code in INCLUDE):
            continue
        o = OVERRIDES.get(code, {})
        capital = o.get("capital", c["capital"][0])
        alt = o.get("alt", []) + [x for x in c["capital"][1:] if x != capital]

        if code in COORDS:
            lat, lon = COORDS[code]
        else:
            ne = NE_CODE.get(code, code)
            names = {norm(capital), norm(NE_NAME.get(code, capital))} | {norm(a) for a in alt}
            hits = [p for p in places if p["adm0_a3"] == ne and
                    (norm(p["name"]) in names or norm(p.get("nameascii") or "") in names)]
            primary = {norm(capital), norm(NE_NAME.get(code, capital))}
            hits.sort(key=lambda p: (norm(p["name"]) not in primary and
                                     norm(p.get("nameascii") or "") not in primary, -p["adm0cap"]))
            if not hits:
                missing.append((code, capital))
                continue
            lat, lon = hits[0]["latitude"], hits[0]["longitude"]

        entry = {
            "id": code,
            "iso": c["ccn3"] or None,
            "name": o.get("name", c["name"]["common"]),
            "aliases": o.get("aliases", []),
            "capital": capital,
            "alt": alt,
            "continent": continent(c),
            "subregion": c["subregion"],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
        }
        if "note" in o:
            entry["note"] = o["note"]
        out.append(entry)

    if missing:
        raise SystemExit(f"no coordinates for: {missing}")
    out.sort(key=lambda e: e["name"])
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {len(out)} countries to {OUT}")


if __name__ == "__main__":
    main()

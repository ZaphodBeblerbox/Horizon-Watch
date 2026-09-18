"""
ftm.py — the FollowTheMoney data model, adopted natively.

WHY THIS MODEL AND NOT ONE OF OUR OWN. OpenSanctions — which this system
already ingests — publishes in FollowTheMoney, the schema OCCRP and
OpenSanctions built for investigative work. Inventing a parallel model would
mean translating a well-specified graph into a worse one at the door, which is
exactly what was happening: the loader kept `schema == "Vessel"` and dropped
everything else. In the first 60,000 entities of the maritime dataset alone
that discarded 9,702 Persons, 21,032 Sanctions, 1,071 Organizations and 765
links, and kept 300 vessels.

WHY NOT THE followthemoney PACKAGE. It depends on PyICU, which needs system
ICU libraries present at build time — a system dependency the deployed backend
would also need, in exchange for schema constants we can state directly. The
FEED is already FtM-shaped JSON; the model is what matters, not the library.

THE SHAPE. FtM has two kinds of entity and the distinction is the whole point:

  THINGS  Person, Organization, Company, Vessel, Airplane, Address ...
  EDGES   Ownership, Directorship, Membership, Associate, UnknownLink,
          Sanction — entities whose properties POINT AT two other entities.

An edge being an entity is what lets it carry its own dates, its own source
and its own provenance: "A owned B from 2019 to 2022, according to this
dataset" is a fact with a lifetime, not a foreign key.
"""
from __future__ import annotations

# ── things ───────────────────────────────────────────────────────────────
THING_SCHEMATA = {
    "Person", "Organization", "Company", "LegalEntity", "PublicBody",
    "Vessel", "Airplane", "Vehicle", "Address", "Asset", "Security",
    "CryptoWallet", "Position", "Identification", "Passport", "Event",
}

# ── edges: schema -> (source property, target property) ──────────────────
#
# Taken from the FtM schema definitions. Each names which property holds the
# source of the relationship and which holds the target, so an edge can be
# stored as a real edge rather than as a blob nobody can traverse.
EDGE_SCHEMATA = {
    "Ownership":     ("owner", "asset"),
    "Directorship":  ("director", "organization"),
    "Membership":    ("member", "organization"),
    "Associate":     ("person", "associate"),
    "Family":        ("person", "relative"),
    "Employment":    ("employee", "employer"),
    "Representation": ("agent", "client"),
    "UnknownLink":   ("subject", "object"),
    "Succession":    ("predecessor", "successor"),
    "Payment":       ("payer", "beneficiary"),
    "Sanction":      ("entity", "authority"),
    "Documentation": ("entity", "document"),
    "Occupancy":     ("holder", "post"),
    "Participation": ("member", "party"),
}

# Properties that carry a relationship's lifetime. An edge with no dates is
# still an edge; an edge whose dates we silently drop is a claim about the
# present that may be years stale.
DATE_PROPS = ("startDate", "endDate", "date", "createdAt", "modifiedAt",
              "listingDate", "authorityId")

# Identifiers we can match on, strongest first. IMO is hull-lifetime and
# survives renaming and reflagging, which is exactly what shadow-fleet
# vessels do; MMSI is reassigned and spoofed, so it is weaker evidence.
VESSEL_IDS = ("imoNumber", "mmsi", "callSign", "registrationNumber")

NAME_PROPS = ("name", "alias", "previousName", "weakAlias")


def is_edge(schema: str) -> bool:
    return schema in EDGE_SCHEMATA


def is_thing(schema: str) -> bool:
    return schema in THING_SCHEMATA


def first(props: dict, key: str):
    """FtM properties are ALWAYS lists, including single values. Reading one
    as a scalar is the commonest way to lose data from this format."""
    vals = (props or {}).get(key) or []
    if isinstance(vals, (list, tuple)):
        return vals[0] if vals else None
    return vals


def all_values(props: dict, *keys) -> list:
    out = []
    for k in keys:
        v = (props or {}).get(k) or []
        if isinstance(v, (list, tuple)):
            out.extend(str(x) for x in v if x)
        elif v:
            out.append(str(v))
    return out


def names(props: dict) -> list[str]:
    """Every name a thing is known by — including aliases and PREVIOUS names.

    Previous names matter more here than anywhere else in the product: a
    sanctioned tanker is renamed and reflagged precisely to break the link to
    its listing, so matching only on current name misses the vessels most
    worth finding.
    """
    seen, out = set(), []
    for n in all_values(props, *NAME_PROPS):
        k = n.strip().upper()
        if k and k not in seen:
            seen.add(k)
            out.append(n.strip())
    return out


def edge_endpoints(schema: str, props: dict) -> tuple[str | None, str | None]:
    spec = EDGE_SCHEMATA.get(schema)
    if not spec:
        return None, None
    return first(props, spec[0]), first(props, spec[1])


def normalise_imo(value) -> str | None:
    """"IMO9811000" and "9811000" are the same hull."""
    if not value:
        return None
    s = str(value).strip().upper().replace(" ", "")
    if s.startswith("IMO"):
        s = s[3:]
    return s if s.isdigit() and len(s) == 7 else None


def normalise_mmsi(value) -> str | None:
    if not value:
        return None
    s = "".join(ch for ch in str(value) if ch.isdigit())
    return s if len(s) == 9 else None

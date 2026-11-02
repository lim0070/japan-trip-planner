# Five-chain expansion coverage

Staged national source query, observed 2026-11-02T21:13:58.129752Z, published Overture Places release 2026-10-21.0. **Partial source coverage, not a complete national inventory or verified unique active-store count.**

Combined **6,659 source records**: original 5,393 unchanged plus 1,266 additions. Every added record has source WKB Point coordinates (medium confidence, null verifiedAt), a source address string (possibly partial), unknown current operation, and null hoursText/hours. No operator hours were copied or fabricated. 1,988 of 3,254 new candidates are quarantined; 0 overlap conflicts with the original source identities.

| Brand ID | Category ID | Listed | Located | Unresolved coordinates | Address string | Hours known |
|---|---|---:|---:|---:|---:|---:|
| costco | warehouse-clubs | 38 | 38 | 0 | 38 | 0 |
| lopia | supermarkets | 107 | 107 | 0 | 107 | 0 |
| life-supermarket | supermarkets | 162 | 162 | 0 | 162 | 0 |
| nitori | furniture-home | 891 | 891 | 0 | 891 | 0 |
| hands | lifestyle-diy | 68 | 68 | 0 | 68 | 0 |

## Formats

| Brand:format ID | Source records |
|---|---:|
| costco:warehouse | 38 |
| lopia:standard | 107 |
| life-supermarket:standard | 162 |
| nitori:nitori-express | 22 |
| nitori:standard | 869 |
| hands:standard | 68 |

Costco warehouse and Nitori EXPRESS formats are explicit; ordinary Hands retains former Tokyu Hands source aliases, not a separate former-name format. No Deco Home/N+/Shimachu/Hands Be/Plugs Market/CAINZ/Handsman/BIO-RAL/Central Square/Miniel expansion was inferred. All original WORKMAN formats and separate Shimamura-related brands remain unchanged.

## Geographic scope

Additive national JP source-country/geometry-box query of Oct21 Overture Places; partial source coverage, not verified unique active stores. Exact five requested chains only; other related brands quarantined.

New source address strings include labels for 47 Japanese prefectures. 513 added records lack a safely normalized Japanese prefecture label; source-country JP is still explicit. A missing label does not imply no store in that prefecture, and a national query does not imply a chain operates in every prefecture. Detailed per-prefecture listed/located/unresolved/hours counts are in data/coverage.json.

| Prefecture label | Added source records |
|---|---:|
| 北海道 | 28 |
| 青森県 | 8 |
| 岩手県 | 6 |
| 宮城県 | 8 |
| 秋田県 | 4 |
| 山形県 | 2 |
| 福島県 | 2 |
| 茨城県 | 6 |
| 栃木県 | 8 |
| 群馬県 | 7 |
| 埼玉県 | 55 |
| 千葉県 | 47 |
| 東京都 | 84 |
| 神奈川県 | 72 |
| 新潟県 | 7 |
| 富山県 | 5 |
| 石川県 | 9 |
| 福井県 | 3 |
| 山梨県 | 10 |
| 長野県 | 5 |
| 岐阜県 | 15 |
| 静岡県 | 17 |
| 愛知県 | 44 |
| 三重県 | 14 |
| 滋賀県 | 9 |
| 京都府 | 19 |
| 大阪府 | 82 |
| 兵庫県 | 44 |
| 奈良県 | 5 |
| 和歌山県 | 4 |
| 鳥取県 | 1 |
| 島根県 | 1 |
| 岡山県 | 9 |
| 広島県 | 19 |
| 山口県 | 9 |
| 徳島県 | 2 |
| 香川県 | 10 |
| 愛媛県 | 4 |
| 高知県 | 2 |
| 福岡県 | 30 |
| 佐賀県 | 5 |
| 長崎県 | 6 |
| 熊本県 | 7 |
| 大分県 | 5 |
| 宮崎県 | 3 |
| 鹿児島県 | 5 |
| 沖縄県 | 6 |

## Review, unknowns and exclusions

36 new same-brand nearby pairs (35m heuristic) are retained for review, alongside 436 baseline pairs. Larger centre duplicates and old/relocated branches may be farther apart. The combined provider-native identity conflict list contains 25 groups. No source record is merged by name, address or coordinate; shared-address branches remain separate. Neither these counts nor high existence confidence verifies actual entrance/current operation.

Quarantine audit reasons:
- 41: nitori-non-home-retail-category
- 1310: life-not-supermarket-category
- 30: hands-related-format-or-unrelated-retailer-pending-scope
- 77: hands-non-retail-category
- 87: nitori-unapproved-related-brand-or-nonstore
- 32: lopia-not-confirmed-grocery-retail
- 198: no-confident-approved-leading-chain
- 21: costco-reseller-component-or-nonwarehouse
- 34: existence-confidence-below-0.75-review-required
- 15: hands-chain-identity-not-established
- 1: audited-exclusion: Hands-named record with Varie phone-accessory business URL; unresolved source metadata conflict, quarantined for review, not asserted nonexistent or a wrong store.
- 13: costco-warehouse-identity-not-established
- 105: life-chain-domain-not-established
- 9: costco-nonwarehouse-category
- 1: audited-exclusion: Hands-named record with MOMI&TOY food business website; unresolved source metadata conflict, quarantined for review, not asserted nonexistent or a wrong store.
- 3: life-unapproved-related-brand-pending-scope
- 1: audited-exclusion: Nitori-named record with clothing taxonomy and unrelated RALODEMALO blog URL; unresolved source metadata conflict, quarantined for review, not asserted nonexistent or a wrong store.
- 1: audited-exclusion: Scope/metadata conflict: source name 東急ハンズ梅田店 but only website handscafe.jp, cannot establish ordinary store versus cafe record. Quarantined, not asserted nonexistent.
- 1: audited-exclusion: Hands-named record with Sanco Creative website, ordinary Hands branch identity not established; unresolved source metadata conflict, quarantined for review, not asserted nonexistent or a wrong store.
- 1: audited-exclusion: Source brand-name versus website conflict: Nitori-labelled record links nikoand.jp. Quarantined pending independent branch identity reconciliation, not asserted wrong store.
- 4: unrelated-ropia-dessert-manufacturer
- 1: audited-exclusion: Temporary renovation closure as of2026-11-02; official branch notice announces reopening2026-11-06. Quarantine until actual reopening is rechecked; not permanently closed.
- 1: audited-exclusion: Source name BOXOUTLET CHITOSE and hands-truck.com/shop/chitose_box indicate nonstandard/possibly historic outlet format outside approved ordinary Hands scope. Quarantined pending explicit format/current-status evidence.
- 1: audited-exclusion: Hands-named record with Studio Mario photography blog URL; unresolved source metadata conflict, quarantined for review, not asserted nonexistent or a wrong store.

Explicit audited exclusions are keyed by native GERS ID in research/audited-exclusions.json. Lopia おおたかの森コトエ is temporarily closed for renovation as of November2; the official notice announces November6 reopening. It remains quarantined until actual reopening is rechecked, not classified permanently closed. A dated Modelboard follow-up was created. Eight further records with cafe/nonstandard Hands or Nitori/Hands unrelated-domain conflicts remain in review, not asserted nonexistent. No branch floor is synthesized from conflicting sources.

## Data rights and reproducibility

Feed size 19,766,378 bytes, below the real Planner20MiB parser cap. Real parseJSON/verifyFeed passes, all original place snapshots deep-equal their baseline, and tampered checksums/unpaired coordinates/duplicate keys are rejected. Seven offline scope/identity regression cases pass. Final checksum uses Planner's exact JavaScript canonicalization, preserving source precision and handling integral floats without rounding.

Dataset checksum: `sha256:9b22826d84301f1ceb004d55e06359f8db2fe4f2786bdc0abffe9884d4c74211`.
Actual file SHA-256: `9f12dbbfe2638c4845c7475222fb403789a8cc6119926b6f6bddbdc976a46f9f`.

Actual provider contributions (multiple entries per place, not store counts):
- meta: 3094
- Overture: 6659
- AllThePlaces: 2567
- Foursquare: 842
- Microsoft: 156

The complete data/shopping-LICENSES directory applies to the combined feed. It includes source inventory, CDLA and Apache agreements, Foursquare notice and original/expansion modification notices. The old/currently deployed feed bytes remain unchanged; immutable base file SHA-256 is 2c9a907aed161d1efd6e73273e78f1fbe6338ca4fa8bc7b76593cd0a31bccde0. Source/term interpretation and official research boundaries are in research/SOURCE-PLAN-AND-RULES.md.

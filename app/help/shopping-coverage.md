# Coverage: staged national shopping snapshot

Observed 2026-11-02T20:54:52.853286Z. Published source release 2026-10-21.0. **This is not complete nationwide coverage or a verified active-store census.** Counts are source identities, not proven unique physical branches.

5,393 records are mapped using exact source WKB Point geometry; all have medium coordinate confidence and null verification dates. 5,391 have an address string, including partial/locality-only strings; 5,340 have a source freeform street/address component. Zero have sourced opening hours or structured hours. 5,392 have unknown current operating status. One historic outlet (ATC Town Outlet MARE) is explicitly closed from the operator's 2020 closure announcement.

## Brand counts

| Brand ID | Listed | Located | Unresolved coordinates | Address string | Hours known |
|---|---:|---:|---:|---:|---:|
| outlet-mall | 39 | 39 | 0 | 39 | 0 |
| gu | 388 | 388 | 0 | 388 | 0 |
| uniqlo | 917 | 917 | 0 | 917 | 0 |
| global-work | 97 | 97 | 0 | 97 | 0 |
| workman | 1385 | 1385 | 0 | 1385 | 0 |
| shimamura | 1690 | 1690 | 0 | 1689 | 0 |
| avail | 381 | 381 | 0 | 380 | 0 |
| birthday | 348 | 348 | 0 | 348 | 0 |
| chambre | 128 | 128 | 0 | 128 | 0 |
| divalo | 20 | 20 | 0 | 20 | 0 |

## WORKMAN formats

| Format ID | Source label | Listed/located |
|---|---|---:|
| workman | WORKMAN | 413 |
| workman-colors | Workman Colors / ワークマンカラーズ | 85 |
| workman-girl | #ワークマン女子 | 29 |
| workman-plus | WORKMAN Plus / ワークマンプラス | 852 |
| workman-pro | WORKMAN Pro | 6 |

Format labels come from published names/brand tags; no inference from merchandise. WORKMAN without a suffix remains `workman`, with a stale-format warning. No current official-format reconciliation is claimed. Other brands use `standard`.

## Geographic scope

National Japan filter (explicit source address country JP, point bbox within 122–154 E / 20–46 N) of Overture Places 2026-10-21.0. Incomplete community/provider coverage, NOT a complete branch census. Listed counts are source identities; possible duplicates are retained. No non-Japan country inferred from a coordinate box.

Sourced Japanese prefecture labels represent all 47 prefectures; 2,128 records have no safely normalized prefecture label. These still have explicit source JP country tags. No prefecture, address or branch is guessed from coordinates.

| Prefecture label | Listed/located |
|---|---:|
| 北海道 | 130 |
| 青森県 | 50 |
| 岩手県 | 44 |
| 宮城県 | 73 |
| 秋田県 | 39 |
| 山形県 | 42 |
| 福島県 | 63 |
| 茨城県 | 121 |
| 栃木県 | 76 |
| 群馬県 | 88 |
| 埼玉県 | 228 |
| 千葉県 | 172 |
| 東京都 | 175 |
| 神奈川県 | 154 |
| 新潟県 | 86 |
| 富山県 | 37 |
| 石川県 | 37 |
| 福井県 | 30 |
| 山梨県 | 33 |
| 長野県 | 74 |
| 岐阜県 | 63 |
| 静岡県 | 111 |
| 愛知県 | 158 |
| 三重県 | 43 |
| 滋賀県 | 47 |
| 京都府 | 60 |
| 大阪府 | 178 |
| 兵庫県 | 118 |
| 奈良県 | 35 |
| 和歌山県 | 29 |
| 鳥取県 | 22 |
| 島根県 | 18 |
| 岡山県 | 49 |
| 広島県 | 54 |
| 山口県 | 47 |
| 徳島県 | 18 |
| 香川県 | 28 |
| 愛媛県 | 33 |
| 高知県 | 20 |
| 福岡県 | 133 |
| 佐賀県 | 23 |
| 長崎県 | 32 |
| 熊本県 | 44 |
| 大分県 | 42 |
| 宮崎県 | 35 |
| 鹿児島県 | 45 |
| 沖縄県 | 28 |

## Quality exclusions and duplicates

The query returned 7,456 candidates. 2,063 are quarantined in `data/rejected-features.json`: unrelated names/categories, low existence confidence (<0.75), tenants incorrectly categorized as malls, centre components and unresolved operation/branch identities. `research/audited-exclusions.json` gives explicit GERS-ID reasons; Rera is quarantined pending current operator/remaining-tenant confirmation. Original licensed records remain in the source cache.

`data/duplicate-candidates.json` flags 436 same-brand pairs within 35 metres, involving 859 source identities. This is a review heuristic, not a definitive duplicate test; large mall duplicates can be farther apart. `data/identity-conflicts.json` contains 16 groups sharing a native provider record ID across GERS identities. No identity is silently merged by name or coordinate. Numbers can exceed an operator's true active count because of old/duplicate source records.

Outlet results are **centre-level candidates**, with obvious tenants/components removed after auditing. Some centres have multiple source identities and alternative source-language names. Do not sum these as unique centres or assume the list covers all operators. Do not promote a source point or approximate address to a verified entrance.

## Remaining national coverage work

- Complete operator branch inventories and current official opening hours for all requested chains
- A reconciled all-operator nationwide outlet-centre universe
- Comprehensive closure/relocation records and entrance verification
- Any source missing Japan country/address or outside this retrieval box
- Low/missing metadata may prevent classification; rejected records are retained for audit

Official source investigation is in `research/SOURCE-RULES.md`. No operator bulk inventory is included. Shimamura/GLOBAL WORK direct access was denied and not bypassed; bulk redistribution rights of other directories were not established. OSM public requests failed and no OSM record data enters this snapshot. Licensed Overture data is the separate permitted route.

## Validation and licenses

Planner `parseJSON`, `verifyFeed`, exact schema and canonical checksum pass. Feed is 15,952,183 bytes (below Planner's 20 MiB parser limit); checksum `sha256:8e90ed1e3c596907680cd7da8f3bfdb414226ce44cc3815aeebc7b45124101f5`. Twelve offline behavior tests pass; tampered checksum and unpaired coordinates are rejected by the real Planner validator.

Publish `data/shopping-LICENSES/` beside the feed and retain source.attribution. The actual source inventory is in that directory; exact redistribution/export obligations and file mappings are in `HANDOFF.md`. Source observations/update times are provenance, never invented field-verification dates.

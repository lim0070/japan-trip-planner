"""Memory-bounded separate ODbL research extraction. No published feed mutation.

Lexical hits are candidate identities, never confirmed branches or aliases.
Only candidate way nodes are resolved; no national in-memory location index.
"""
from pathlib import Path
import json, re, unicodedata, collections, datetime, time
import osmium

ROOT=Path(__file__).resolve().parents[1]; R=ROOT/'reconciliation-2026-11-02'
PBF=R/'cache/osm/japan-261101.osm.pbf'; OUT=R/'data/osm-research'; OUT.mkdir(parents=True,exist_ok=True)
PATTERNS=[('gu',r'^(?:gu|ジーユー)(?![a-z])'),('uniqlo',r'^(?:uniqlo|ユニクロ)(?![a-z])'),('global-work',r'^(?:global[ _-]*work|グローバルワーク)(?![a-z])'),('workman',r'^(?:workman|ワークマン)(?![a-z])'),('shimamura',r'^(?:ファッションセンター\s*)?しまむら|^shimamura(?![a-z])'),('avail',r'^(?:アベイル|avail)(?![a-z])'),('birthday',r'^(?:バースデイ|birthday)(?![a-z])'),('chambre',r'^(?:シャンブル|chambre)(?![a-z])'),('divalo',r'^(?:ディバロ|divalo)(?![a-z])'),('costco',r'^(?:コストコ|costco)(?![a-z])'),('lopia',r'^(?:ロピア|lopia)(?![a-z])'),('nitori',r'^(?:ニトリ|nitori)(?![a-z])'),('hands',r'^(?:東急ハンズ|tokyu\s*hands|ハンズ(?!マン)|hands(?!man))(?![a-z])'),('life-supermarket',r'^(?:ライフ|life)(?![a-z])'),('outlet-mall',r'アウトレット|outlet')]
PATTERNS=[(b,re.compile(p,re.I)) for b,p in PATTERNS]
KEEP={'name','name:ja','name:en','branch','branch:ja','branch:en','brand','brand:ja','brand:en','brand:wikidata','operator','operator:wikidata','shop','disused:shop','abandoned:shop','disused','abandoned','disused:name','old_name','was:name','closed','amenity','building','landuse','outlet','opening_hours','opening_hours:PH','opening_hours:covid19','website','contact:website','url','phone','contact:phone','wikidata','ref','ref:shop','start_date','end_date','opening_date','check_date','check_date:opening_hours','survey:date','source','source:position','description','note','fixme'}
def selected(tags):
 text=[unicodedata.normalize('NFKC',tags.get(k,'')) for k in ['name','name:ja','name:en','brand','brand:ja','brand:en']]
 return sorted({b for b,p in PATTERNS if any(p.search(t) for t in text)})
def dump(name,obj):
 p=OUT/name;temp=p.with_suffix(p.suffix+'.partial');temp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n');temp.replace(p)
def progress(phase,**kw):
 d={'phase':phase,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),**kw};dump('progress.json',d);print(json.dumps(d),flush=True)
def main():
 started=time.monotonic(); p=OUT/'tag-candidates.json'
 if p.exists():rows=json.loads(p.read_bytes())
 else:
  rows=[];seen=0
  stream=osmium.FileProcessor(PBF).with_filter(osmium.filter.KeyFilter('shop','brand','disused:shop','abandoned:shop'))
  for obj in stream:
   seen+=1;tags=dict(obj.tags);brands=selected(tags)
   if not brands:continue
   typ='node' if obj.is_node() else 'way' if obj.is_way() else 'relation'
   row={'sourceId':f'osm:{typ}/{obj.id}','osmType':typ,'osmId':str(obj.id),'version':obj.version,'timestamp':str(obj.timestamp),'candidateBrandIds':brands,'identityStatus':'unconfirmed-lexical-candidate','tags':{k:v for k,v in tags.items() if k in KEEP or k.startswith('addr:')},'coordinates':None}
   if typ=='node' and obj.location.valid():row['coordinates']={'lat':obj.location.lat,'lng':obj.location.lon,'method':'osm-node','confidence':'medium','entranceVerified':False}
   elif typ=='way':row['nodeIds']=[n.ref for n in obj.nodes]
   else:row['members']=[{'type':m.type,'ref':m.ref,'role':m.role} for m in obj.members]
   rows.append(row)
   if len(rows)%500==0:progress('tag-scan',retailTaggedObjects=seen,candidates=len(rows),elapsedSeconds=round(time.monotonic()-started,1))
  dump('tag-candidates.json',rows);progress('tag-scan-complete',retailTaggedObjects=seen,candidates=len(rows))
 # Retain direct member ways only; do not pretend nested relation geometry resolved.
 ways={int(r['osmId']):r['nodeIds'] for r in rows if r['osmType']=='way'}
 wanted={m['ref'] for r in rows for m in r.get('members',[]) if m['type']=='w'}-set(ways)
 wp=OUT/'relation-way-nodes.json'
 if wp.exists():extra=json.loads(wp.read_bytes());ways.update({int(k):v for k,v in extra.items()})
 elif wanted:
  extra={}
  for w in osmium.FileProcessor(PBF,osmium.osm.WAY).with_filter(osmium.filter.IdFilter(wanted)):extra[w.id]=[n.ref for n in w.nodes]
  dump('relation-way-nodes.json',extra);ways.update(extra)
 needed={n for ids in ways.values() for n in ids}|{m['ref'] for r in rows for m in r.get('members',[]) if m['type']=='n'}
 np=OUT/'candidate-node-locations.json'
 if np.exists():locations={int(k):v for k,v in json.loads(np.read_bytes()).items()}
 else:
  locations={};progress('coordinate-scan',neededNodeIds=len(needed),candidateWays=len(ways))
  for n in osmium.FileProcessor(PBF,osmium.osm.NODE).with_filter(osmium.filter.IdFilter(needed)):
   if n.location.valid():locations[n.id]=[n.location.lat,n.location.lon]
  dump('candidate-node-locations.json',locations)
 for r in rows:
  ids=r.get('nodeIds',[])
  if r['osmType']=='relation':ids=[n for m in r['members'] if m['type']=='w' for n in ways.get(m['ref'],[])]+[m['ref'] for m in r['members'] if m['type']=='n']
  coords=[locations[n] for n in ids if n in locations]
  if coords and len(coords)==len(ids):
   r['coordinates']={'lat':(min(x[0] for x in coords)+max(x[0] for x in coords))/2,'lng':(min(x[1] for x in coords)+max(x[1] for x in coords))/2,'method':'osm-member-node-bounds-centre','confidence':'low','entranceVerified':False,'note':'Approximate display point, not a storefront/entrance or verified branch. Nested relation members unresolved.'}
  r['license']='ODbL-1.0';r['sourceUrl']='https://www.openstreetmap.org/'+r['osmType']+'/'+r['osmId'];r['sourceExtract']='Geofabrik Japan 2026-11-01T21:21:36Z';r['publicationBoundary']='Separate OSM research package; do not mix into frozen Overture release or confirmed aliases.'
 dump('approved-brand-candidates.json',rows)
 summary={'source':'https://download.geofabrik.de/asia/japan-261101.osm.pbf','dataTimestamp':'2026-11-01T21:21:36Z','license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','candidateSourceIdentities':len(rows),'locatedCandidates':sum(r['coordinates'] is not None for r in rows),'rawOpeningHoursTags':sum(bool(r['tags'].get('opening_hours')) for r in rows),'byCandidateBrand':dict(collections.Counter(b for r in rows for b in r['candidateBrandIds'])),'identityStatus':'Lexical research candidates, not unique or active branch coverage. Multiple brand hits and tenant/component records require review.','elapsedSeconds':round(time.monotonic()-started,1)}
 dump('summary.json',summary);progress('complete',**summary)
if __name__=='__main__':main()

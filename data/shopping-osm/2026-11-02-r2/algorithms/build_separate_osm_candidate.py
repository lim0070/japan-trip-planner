"""ODbL-only normalized derivative. Never modifies the Overture feed/fixture."""
from extract_reconciliation_osm import R,OUT
from build import PREFS,safe_url
from pathlib import Path
import json,re,hashlib,datetime,shutil,collections,argparse

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',default='osm-candidate-2026-11-02-r2');args=parser.parse_args();assert re.fullmatch(r'osm-candidate-[a-zA-Z0-9-]+',args.output)
 rows=json.loads((OUT/'scoped-source-records.json').read_bytes());dest=R/args.output
 if dest.exists():raise RuntimeError('Immutable candidate exists; select a new --output name')
 dest.mkdir();lifecycleConflicts=[]
 observed=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z');places=[]
 for r in rows:
  t=r['tags'];sourceId='osm:'+r['osmType']+':'+r['osmId'];url=r['sourceUrl'];notes=['Community source assertion; not a verified current branch census.','Separate ODbL derivative; no official/Overture/ATP field enrichment or cross-source aliases.'];ev=lambda field,note:{'field':field,'sourceKind':'openstreetmap','url':url,'observedAt':observed,'note':note}
  raw=t.get('name:ja') or t.get('name') or t.get('name:en') or t.get('brand:ja') or t.get('brand') or t.get('brand:en');assert raw
  ja=raw if re.search(r'[\u3040-\u30ff\u3400-\u9fff]',raw) else t.get('name:ja');en=t.get('name:en') or (raw if not ja else None)
  addr=t.get('addr:full') or ' '.join(dict.fromkeys(t[k] for k in ['addr:province','addr:prefecture','addr:state','addr:city','addr:suburb','addr:quarter','addr:neighbourhood','addr:place','addr:street','addr:block_number','addr:housenumber'] if t.get(k))) or None
  for key in ['addr:housename','addr:building','addr:floor','addr:unit']:
   if t.get(key) and (key not in ['addr:building','addr:housename'] or t[key] not in (addr or '')):
    value=t[key] if key in ['addr:building','addr:housename'] else ('floor ' if key=='addr:floor' else 'unit ')+t[key];addr=((addr+' ') if addr else '')+value
  pref=next((t[k] for k in ['addr:province','addr:prefecture','addr:state'] if t.get(k) in PREFS),None) or next((p for p in PREFS if p in (addr or '')),None)
  evidence=[ev('identity',f"OSM {r['osmType']}/{r['osmId']} version{r['version']}, source object edited{r['timestamp']}. Extract2026-11-01T21:21:36Z; normalized/acquired{observed}. None of these dates is a venue or hours verification. Brand/format scope from community source tags, no silent physical-branch merge.")]
  if addr:evidence.append(ev('address','Source addr tags, possibly partial; no geocoding, translation or official field graft.'))
  else:notes.append('Source has no postal address; point geometry does not supply one.')
  c=r['coordinates'];location={'lat':c['lat'] if c else None,'lng':c['lng'] if c else None,'availability':'located' if c else 'unknown','confidence':c['confidence'] if c else 'unknown','method':c['method'] if c else None,'provenance':[ev('coordinates','Source node position, entrance unverified.' if r['osmType']=='node' else 'Computed bounds centre of complete direct source-member node positions; approximate, not a storefront/entrance. No nested relations in this candidate.')] if c else [],'verifiedAt':None}
  if r['osmType']!='node':notes.append('Low-confidence geometry centre may be far from the entrance; use exact branch/address to verify navigation.')
  hours=t.get('opening_hours') or None
  if hours:evidence.append(ev('hours','Raw community opening_hours reference; not parsed into calendar intervals or independently verified. Source exceptions and closure notices may be missing.'))
  conflict=bool(t.get('shop') and (t.get('disused:shop') or t.get('abandoned:shop')))
  status='unknown' if conflict else 'closed' if t.get('disused')=='yes' or t.get('abandoned')=='yes' or t.get('shop') in ['closed','vacant'] or (not t.get('shop') and (t.get('disused:shop') or t.get('abandoned:shop'))) else 'unknown'
  statusNote='OSM lifecycle tags only; current operation, announced openings, relocation and temporary closures need source-specific checks.'
  if conflict:
   statusNote='Conflicting live and disused/abandoned retail tags: shop='+str(t.get('shop'))+'; disused:shop='+str(t.get('disused:shop'))+'; abandoned:shop='+str(t.get('abandoned:shop'))+'. Current operation unresolved; not automatic former-tenant closure.';notes.append(statusNote);evidence.append(ev('operatingStatus',statusNote));lifecycleConflicts.append('shopping:'+sourceId)
  if status=='closed':evidence.append(ev('operatingStatus','Source lifecycle tag says disused/abandoned/closed. Historical identity retained; not operator live verification.'))
  for key in ['start_date','end_date','opening_date','old_name','disused:name','was:name','check_date','check_date:opening_hours','note','fixme']:
   if t.get(key):notes.append('OSM '+key+': '+t[key])
  links=[{'kind':'source','label':'OpenStreetMap source feature','url':url}];site=safe_url(t.get('website') or t.get('contact:website'))
  if site:links.append({'kind':'official','label':'Website asserted by OSM, unverified','url':site})
  p={'schemaVersion':1,'key':'shopping:'+sourceId,'sourceId':sourceId,'names':{'ja':ja,'en':en,'romaji':None,'branchJa':t.get('branch:ja') or t.get('branch')},'address':{'ja':addr,'en':None,'prefecture':pref,'city':t.get('addr:city'),'postalCode':t.get('addr:postcode')},'category':'Shopping','location':location,'operatingStatus':{'value':status,'checkedAt':None,'note':statusNote},'hoursText':hours,'hours':None,'links':links,'awards':[],'memberships':[],'hallOfFame':None,'reviewNotes':notes,'provenance':evidence,'shopping':r['approvedScope']};places.append(p)
 places.sort(key=lambda p:p['key'].encode());assert len({p['key'] for p in places})==len(places)
 raw=(OUT/'scoped-source-records.json').read_bytes();(dest/'osm-derivative.v1.json').write_bytes(raw);shutil.copyfile(OUT/'ODbL-1.0.txt',dest/'ODbL-1.0.txt')
 attribution='© OpenStreetMap contributors. OSM-only shopping derivative under ODbL1.0: https://opendatacommons.org/licenses/odbl/1-0/ . https://www.openstreetmap.org/copyright . Complete derivative bundled at ./osm-derivative.v1.json, resolved against this package/export root; exact bytes/hash bound by package-inventory.v1.json and source-and-modifications.json. No official/Overture/ATP fields. Incomplete source features, not unique/verified active branches.'
 feed={'schemaVersion':1,'source':{'namespace':'shopping','title':'Japan shopping — separate OSM derivative, partial coverage','standaloneUrl':None,'inputFiles':['osm-derivative.v1.json'],'inputSha256':{'osm-derivative.v1.json':hashlib.sha256(raw).hexdigest()},'attribution':attribution},'lists':[],'places':places,'datasetVersion':'sha256:'+'0'*64,'generatedAt':observed}
 (dest/'shopping-osm.v1.json').write_text(json.dumps(feed,ensure_ascii=False,separators=(',',':'))+'\n');(dest/'ATTRIBUTION.txt').write_text(attribution+'\n')
 summary={'sourceFeatureCount':len(places),'located':sum(p['location']['lat'] is not None for p in places),'referenceHours':sum(bool(p['hoursText']) for p in places),'sourceClosedTags':sum(p['operatingStatus']['value']=='closed' for p in places),'currentOperationUnknown':sum(p['operatingStatus']['value']=='unknown' for p in places),'addressStrings':sum(bool(p['address']['ja']) for p in places),'addressStringQuality':'Unverified community strings; may contain only a city/building/floor. Not verified postal addresses.','withoutFullHouseOrBlockTags':sum(bool(p['address']['ja']) and not any(r['tags'].get(k) for k in ['addr:full','addr:housenumber','addr:block_number']) for p,r in zip(places,sorted(rows,key=lambda x:('shopping:osm:'+x['osmType']+':'+x['osmId']).encode()))),'lifecycleConflictKeys':sorted(lifecycleConflicts),'prefectureKnown':sum(p['address']['prefecture'] in PREFS for p in places),'byBrand':dict(collections.Counter(p['shopping']['brandId'] for p in places)),'uniqueNationalBranches':None,'publicActivation':False}
 (dest/'coverage.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 (dest/'source-and-modifications.json').write_text(json.dumps({'license':'ODbL-1.0','sourceUrl':'https://download.geofabrik.de/asia/japan-261101.osm.pbf','sourceDataTimestamp':'2026-11-01T21:21:36Z','sourceMd5':'a49fa3af3d11e1702d236cd86dde67fb','changes':['Selected approved retail source-tag candidates and conservative brand/format/taxonomy scope; no cross-source field joins.','Retained native OSM IDs/version/edit times and raw business hours, address/building/floor strings and lifecycle conflicts/uncertainty.','Way/relation positions approximated by direct member-node bounds centre, low confidence, entrance unverified.'],'algorithmFiles':['algorithms/extract_reconciliation_osm.py','algorithms/scope_reconciliation_osm.py','algorithms/build_separate_osm_candidate.py','algorithms/build.py'],'algorithmRuntime':'Python3.9+, pyosmium4.3.2; scripts document original workspace layout. Complete selected derivative is bundled and does not require rerunning the algorithms.','machineReadableDerivative':'osm-derivative.v1.json','dataAccess':{'kind':'bundled-relative-file','path':'osm-derivative.v1.json','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'resolveAgainst':'this package or export root; retain this file with exported source snapshots'},'fullLicense':'ODbL-1.0.txt','attribution':'ATTRIBUTION.txt'},ensure_ascii=False,indent=2)+'\n')
 # Final feed checksum is canonicalized by the real JS validator before inventory.
 (dest/'algorithms').mkdir()
 for name in ['extract_reconciliation_osm.py','scope_reconciliation_osm.py','build_separate_osm_candidate.py','build.py']:
  shutil.copyfile(R.parent/'src'/name,dest/'algorithms'/name)
 shutil.copyfile(R/'cache/osm/extract.meta.json',dest/'extract.meta.json')
 print(json.dumps({'dest':str(dest),**summary},ensure_ascii=False))
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Deterministic offline normalization of the licensed OSM national extract."""
from pathlib import Path
import json,hashlib,re,math,collections,datetime
ROOT=Path(__file__).resolve().parents[1]
BRANDS=['outlet-mall','gu','uniqlo','global-work','workman','shimamura','avail','birthday','chambre','divalo']
PREFS='北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split()
MATCH=[('uniqlo',r'ユニクロ|\buniqlo\b'),('gu',r'ジーユー|^gu(?:\s|$)'),('global-work',r'グローバルワーク|global\s*work'),('workman',r'ワークマン|workman'),('shimamura',r'しまむら|shimamura'),('avail',r'アベイル|^avail(?:\s|$)'),('birthday',r'バースデイ|^birthday(?:\s|$)'),('chambre',r'シャンブル|^chambre(?:\s|$)'),('divalo',r'ディバロ|^divalo(?:\s|$)')]

def canonical(v): return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def write(path,v): path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
def safe_url(v):
 if not isinstance(v,str) or len(v)>2048:return None
 from urllib.parse import urlsplit
 try:
  p=urlsplit(v)
  return v if p.scheme in ['http','https'] and p.netloc and not p.username and not p.password else None
 except ValueError:return None

def classify(t):
 # Explicit brand identity outranks co-tenant references in a branch name.
 for key in ['brand','brand:ja','brand:en','name','name:ja','name:en']:
  value=t.get(key,'')
  for b,p in MATCH:
   if re.search(p,value,re.I):return b
 name=t.get('name:ja') or t.get('name','')
 if re.search(r'アウトレット|outlet|軽井沢.*ショッピングプラザ',name,re.I):
  if t.get('shop')=='mall' or t.get('landuse')=='retail':return 'outlet-mall'
  if not t.get('shop') and re.search(r'三井アウトレットパーク|プレミアム.?アウトレット|アウトレットモール|アウトレットパーク|THE OUTLETS|レイクタウン.?アウトレット|軽井沢.*ショッピングプラザ',name,re.I):return 'outlet-mall'
 if t.get('shop')=='mall' and t.get('outlet')=='yes':return 'outlet-mall'
 return None

def workman_format(t):
 s=' '.join(t.get(k,'') for k in ['name','name:ja','name:en','brand','brand:ja','brand:en'])
 if re.search(r'colors|colours|カラーズ|カラー',s,re.I):return 'workman-colors'
 if re.search(r'plus|プラス|workman\s*\+',s,re.I):return 'workman-plus'
 if re.search(r'女子|girl',s,re.I):return 'workman-girl'
 if re.search(r'\bpro\b|プロ',s,re.I):return 'workman-pro'
 return 'workman'

def normalize(e,observed):
 t=e.get('tags',{}); b=classify(t)
 if not b:return None
 ident=f"osm:{e['type']}:{e['id']}";url=f"https://www.openstreetmap.org/{e['type']}/{e['id']}"
 notes=[]
 def ev(field,note):return {'field':field,'sourceKind':'openstreetmap','url':url,'observedAt':observed,'note':note}
 evidence=[ev('identity',f"OSM {e['type']}/{e['id']}; source object timestamp {e.get('timestamp','unknown')}; version {e.get('version','unknown')}. Object edit time is not field verification.")]
 rawname=t.get('name:ja') or t.get('name')
 if not rawname:
  rawname=t.get('brand:ja') or t.get('brand')
  notes.append('No branch name in OSM; object identity and available address locate this source feature. Confirm branch before travel.')
 if not rawname:return None
 # Preserve source strings; do not translate or manufacture branch names.
 ja=rawname if re.search(r'[\u3040-\u30ff\u3400-\u9fff]',rawname) else t.get('name:ja')
 en=t.get('name:en') or (rawname if not ja else None)
 pref=t.get('addr:province') or t.get('addr:prefecture')
 city=t.get('addr:city')
 addr=t.get('addr:full')
 parts=[t.get(k) for k in ['addr:province','addr:city','addr:suburb','addr:quarter','addr:neighbourhood','addr:place','addr:street','addr:block_number','addr:housenumber']]
 if not addr: addr=' '.join(dict.fromkeys(p for p in parts if p)) or None
 if not pref and addr: pref=next((p for p in PREFS if p in addr),None)
 if addr:
  evidence.append(ev('address','OSM addr tags, may be partial; no reverse geocoding or official confirmation.'))
  if not (t.get('addr:full') or (city and any(t.get(k) for k in ['addr:street','addr:place','addr:quarter','addr:block_number','addr:housenumber']))):notes.append('OSM address is partial; confirm full address using source link.')
 else:notes.append('Address unavailable in OSM; coordinates are not a sourced postal address.')
 if pref and pref not in PREFS:notes.append('Source prefecture tag is not normalized to a Japanese prefecture name.')
 c=e if e['type']=='node' else e.get('center',{})
 lat,lng=c.get('lat'),c.get('lon')
 if not (isinstance(lat,(int,float)) and isinstance(lng,(int,float)) and -90<=lat<=90 and -180<=lng<=180):lat=lng=None
 located=lat is not None
 method='osm-node' if e['type']=='node' else 'osm-geometry-bounding-box-center'
 ce=[]
 if located:
  ce=[ev('coordinates','Source node position; entrance not verified.' if e['type']=='node' else 'Overpass out center gives geometry bounding-box centre, not an entrance or verified destination.')]
  notes.append('Community mapped location; verify destination/entrance before travel.' if e['type']=='node' else 'Approximate geometry bounding-box centre; may be far from an entrance. Use name/address for navigation.')
 hours=t.get('opening_hours') or None
 if hours:evidence.append(ev('hours','Raw OSM opening_hours expression, unverified and potentially stale; reference only, not parsed into calendar intervals.'))
 # A shop tag alone does not establish that it is currently operating.
 status='unknown'
 if t.get('disused')=='yes' or t.get('abandoned')=='yes' or t.get('shop') in ['vacant','closed']:status='closed'
 if t.get('end_date'):notes.append('OSM end_date='+t['end_date']+'; current operation requires review.')
 for k in ['old_name','disused:name','was:name','start_date','check_date','check_date:opening_hours','note','fixme']:
  if t.get(k):notes.append('OSM '+k+': '+t[k])
 if status=='closed':evidence.append(ev('operatingStatus','OSM disused/abandoned/closed tags; not operator verified.'))
 links=[{'kind':'source','label':'OpenStreetMap source feature','url':url}]
 site=safe_url(t.get('website') or t.get('contact:website'))
 if site:links.append({'kind':'official','label':'Website recorded by OSM (unverified)','url':site})
 return {'schemaVersion':1,'key':'shopping:'+ident,'sourceId':ident,'names':{'ja':ja,'en':en,'romaji':None,'branchJa':t.get('branch:ja') or t.get('branch')},'address':{'ja':addr,'en':None,'prefecture':pref,'city':city,'postalCode':t.get('addr:postcode')},'category':'Shopping','location':{'lat':lat,'lng':lng,'availability':'located' if located else 'unknown','confidence':('medium' if e['type']=='node' else 'low') if located else 'unknown','method':method if located else None,'provenance':ce,'verifiedAt':None},'operatingStatus':{'value':status,'checkedAt':None,'note':'Community source feature; current operation, closures and relocations are not comprehensively verified.'},'hoursText':hours,'hours':None,'links':links,'awards':[],'memberships':[],'hallOfFame':None,'reviewNotes':notes,'provenance':evidence,'shopping':{'brandId':b,'formatId':workman_format(t) if b=='workman' else 'standard'}}

def distance(a,b):
 x,y=a['location'],b['location']; lat=(x['lat']+y['lat'])/2*math.pi/180
 return math.hypot((x['lat']-y['lat'])*111195,(x['lng']-y['lng'])*111195*math.cos(lat))

def build():
 rawpath=ROOT/'cache/osm/japan-shopping.json';metapath=ROOT/'cache/osm/japan-shopping.meta.json'
 raw=json.loads(rawpath.read_bytes());meta=json.loads(metapath.read_bytes());observed=meta['observedAt']
 if raw.get('remark'):raise ValueError('Overpass partial/error response refused')
 assert hashlib.sha256(rawpath.read_bytes()).hexdigest()==meta['sha256'],'Input hash mismatch'
 places=[];rejected=[]
 for e in raw['elements']:
  p=normalize(e,observed)
  if p:places.append(p)
  else:rejected.append({'type':e['type'],'id':str(e['id']),'tags':e.get('tags',{}),'reason':'No confident requested brand/centre classification or missing identity name'})
 places.sort(key=lambda p:p['key'])
 assert len({p['key'] for p in places})==len(places),'Duplicate OSM identity'
 # Flag nearby same-brand OSM features for human review; never merge by proximity/name.
 potential=[];bins=collections.defaultdict(list)
 for p in places:
  l=p['location']
  if l['lat'] is None:continue
  x,y=math.floor(l['lat']*1000),math.floor(l['lng']*1000);brand=p['shopping']['brandId']
  for dx in [-1,0,1]:
   for dy in [-1,0,1]:
    for q in bins[(brand,x+dx,y+dy)]:
     d=distance(p,q)
     if d<35:
      potential.append({'keys':[q['key'],p['key']],'distanceMeters':round(d,1),'reason':'Nearby same-brand features, possible node/area duplicate; retained separately pending review.'})
      for r in [p,q]:
       note='Possible nearby duplicate OSM feature; inspect duplicate-candidates.json. Source identities remain separate.'
       if note not in r['reviewNotes']:r['reviewNotes'].append(note)
  bins[(brand,x,y)].append(p)
 hashes={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ['cache/osm/japan-shopping.json','cache/osm/japan-shopping.meta.json','cache/osm/query.overpassql']}
 feed={'schemaVersion':1,'source':{'namespace':'shopping','title':'Japan shopping — partial OpenStreetMap coverage','standaloneUrl':None,'inputFiles':list(hashes),'inputSha256':hashes,'attribution':'© OpenStreetMap contributors. Shopping database licensed under ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/ . Source: https://www.openstreetmap.org/copyright . Community data, incomplete and not operator verified.'},'lists':[],'places':places}
 feed['datasetVersion']='sha256:'+hashlib.sha256(canonical(feed).encode()).hexdigest();feed['generatedAt']=observed
 write(ROOT/'data/shopping.v1.json',feed)
 write(ROOT/'data/duplicate-candidates.json',potential);write(ROOT/'data/rejected-features.json',rejected)
 def counts(rows):return {'listed':len(rows),'located':sum(p['location']['lat'] is not None for p in rows),'unresolved':sum(p['location']['lat'] is None for p in rows),'addressKnown':sum(p['address']['ja'] is not None for p in rows),'hoursKnown':sum(p['hoursText'] is not None for p in rows),'structuredHours':0,'operationUnknown':sum(p['operatingStatus']['value']=='unknown' for p in rows)}
 cov={'scope':'Japan national OSM admin area query; incomplete community coverage, not complete store census. Counts are OSM source features, possible physical duplicates retained.','observedAt':observed,'osmBaseTimestamp':raw.get('osm3s',{}).get('timestamp_osm_base'),'total':counts(places),'byBrand':{},'byFormat':{},'byPrefecture':{},'prefectureUnknown':counts([p for p in places if p['address']['prefecture'] not in PREFS]),'duplicateCandidatePairs':len(potential),'rejectedFeatures':len(rejected),'officialBulkSourcesUsed':False,'uncollectedSources':['Official nationwide branch inventories (GU, UNIQLO, GLOBAL WORK, WORKMAN, Shimamura group)','Complete outlet-centre operator universe, closures and relocations','Brands absent from the OSM extract; see zero counts'],'license':'ODbL-1.0','datasetVersion':feed['datasetVersion']}
 for b in BRANDS:cov['byBrand'][b]=counts([p for p in places if p['shopping']['brandId']==b])
 for b,f in sorted(set((p['shopping']['brandId'],p['shopping']['formatId']) for p in places)):cov['byFormat'][b+':'+f]=counts([p for p in places if p['shopping']=={'brandId':b,'formatId':f}])
 for pref in PREFS:cov['byPrefecture'][pref]=counts([p for p in places if p['address']['prefecture']==pref])
 write(ROOT/'data/coverage.json',cov);print(json.dumps(cov['total']), 'duplicates',len(potential),'rejected',len(rejected))
 return feed,cov
if __name__=='__main__':build()

"""Conservative approved-brand scope decisions on separate ODbL source records.
Taxonomy/name/brand identity checks never deduplicate physical branches.
"""
from extract_reconciliation_osm import OUT
from build import workman_format
import json,re,collections,unicodedata,urllib.parse

Q={'gu':'Q5512642','uniqlo':'Q26070','workman':'Q11351660','shimamura':'Q7758173','avail':'Q11284759','birthday':'Q113487317','chambre':'Q113489480','nitori':'Q10801453','hands':'Q859212','costco':'Q715583','lopia':'Q11350624','life-supermarket':'Q11346476'}
def decide(r):
 t=r['tags'];name=unicodedata.normalize('NFKC',' '.join(t.get(k,'') for k in ['name','name:ja','name:en','branch','branch:ja','branch:en','brand','brand:ja','brand:en']));shop=t.get('shop') or t.get('disused:shop') or t.get('abandoned:shop');hits=r['candidateBrandIds'];b=None
 if len(hits)==1:b=hits[0]
 else:
  # Chain outlet tenant is a chain record, never the outlet mall parent.
  nonout=[x for x in hits if x!='outlet-mall']
  if len(nonout)==1:b=nonout[0]
  else:return None,None,'multiple approved-brand assertions require manual identity review'
 fmt='standard'
 if b=='outlet-mall':
  if shop not in ['mall','shopping_centre']:return None,None,'outlet tenant/component or no mall taxonomy'
 elif b in ['gu','uniqlo','global-work','workman','shimamura','avail','birthday','chambre']:
  if shop not in ['clothes','fashion','baby_goods','variety_store','department_store','general']:return None,None,'not matching apparel/lifestyle retail taxonomy'
  if b=='workman':fmt=workman_format(t)
 elif b=='divalo':
  if shop not in ['shoes','clothes']:return None,None,'not Divalo shoe/apparel taxonomy'
 elif b=='costco':
  if shop not in ['wholesale','supermarket','supermarket;wholesale','mall','department_store'] or re.search('ガス|gas|フード|food|再販|resell|物流|タイヤ|tire|薬局|pharmacy',name,re.I):return None,None,'Costco nonwarehouse/component/reseller'
  fmt='warehouse'
 elif b=='nitori':
  if re.search('デコ|deco|N\s*\+|エヌプラス|ホームズ|物流|配送|public|本社|法人|リフォーム|ショールーム',name,re.I):return None,None,'unapproved related Nitori format/nonstore'
  if shop not in ['furniture','houseware','interior_decoration','department_store']:return None,None,'not home-furnishing retail taxonomy'
  if re.search('express|エクスプレス',name,re.I):fmt='nitori-express'
 elif b=='hands':
  if re.search(r'ハンズビー|hands\s*be\b|カフェ|cafe|ハンズマン|handsman|プラグス|plugs|セカンド|second',name,re.I):return None,None,'related Hands format/component'
  if shop not in ['variety_store','department_store','doityourself']:return None,None,'not ordinary Hands retail taxonomy'
  if t.get('brand:wikidata')!=Q[b] and not re.search(r'東急ハンズ|tokyu\s*hands',name,re.I) and not any('hands.net' in t.get(k,'') or 'tokyu-hands' in t.get(k,'') for k in ['website','contact:website']):return None,None,'ordinary Hands chain identity lacks explicit chain tag/domain'
 elif b in ['life-supermarket','lopia']:
  if shop!='supermarket':return None,None,'not supermarket taxonomy'
  if re.search('ビオラル|bio.?ral|セントラル|central|miniel|ミニエル|ドラッグプラス|配送センター|EC桜新町|ユータカラヤ',name,re.I):return None,None,'unapproved related grocery format/delivery centre'
  if b=='life-supermarket' and t.get('brand:wikidata')!=Q[b] and not any('lifecorp' in t.get(k,'') or 'life-netsuper.jp' in t.get(k,'') for k in ['website','contact:website']):return None,None,'ambiguous LIFE supermarket without explicit chain tag/domain'
 return b,fmt,None

def main():
 rows=json.loads((OUT/'approved-brand-candidates.json').read_bytes());approved=[];review=[]
 for r in rows:
  b,fmt,reason=decide(r)
  if reason:review.append({'sourceId':r['sourceId'],'candidateBrandIds':r['candidateBrandIds'],'name':r['tags'].get('name'),'reason':reason});continue
  r['approvedScope']={'brandId':b,'formatId':fmt};r['identityStatus']='in-scope-source-assertion-not-confirmed-physical-branch';approved.append(r)
 (OUT/'scoped-source-records.json').write_text(json.dumps(approved,ensure_ascii=False,separators=(',',':'))+'\n');(OUT/'scope-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
 summary={'lexicalCandidates':len(rows),'inScopeSourceIdentities':len(approved),'excludedOrIdentityReview':len(review),'byBrand':dict(collections.Counter(r['approvedScope']['brandId'] for r in approved)),'referenceHours':sum(bool(r['tags'].get('opening_hours')) for r in approved),'uniqueActiveBranches':None,'note':'ODbL-only source assertions, possible node/area duplicates and stale operating status retained; not merged into Overture or operator facts.'}
 (OUT/'scope-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()

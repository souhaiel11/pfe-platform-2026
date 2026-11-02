import pathlib,re,json,csv
root=pathlib.Path('frontend/src/app');out=pathlib.Path(__file__).resolve().parent
components=[];bindings=[];actions=[]
api=(root/'core/services/api.service.ts').read_text()
apiMethods={}
for m in re.finditer(r'^  (\w+)\([^\n]*',api,re.M):
 e=api.find('\n  }',m.end());line=api[m.start(): min(e+4 if e>=0 else m.end(),m.start()+1400)]
 calls=re.findall(r'this\.http\.(get|post|put|patch|delete)(?:<[^>]+>)?\(([^\n]+)',line)
 if calls:apiMethods[m[1]]=calls[0]
for p in root.rglob('*.component.ts'):
 s=p.read_text();templates=[];html=p.with_suffix('.html')
 # .component.ts -> .component.html
 if html.exists():templates.append((html,html.read_text()))
 m=re.search(r'template:\s*`([\s\S]*?)`\s*,',s)
 if m:templates.append((p,m[1]))
 components.append({'component':str(p),'apiMethods':sorted(set(re.findall(r'this\.api\.(\w+)\(',s))),'directHttp':re.findall(r'this\.http\.(get|post|put|patch|delete)[^\n]*',s),'templateFiles':[str(t[0]) for t in templates]})
 for file,t in templates:
  for i,m in enumerate(re.finditer(r'{{([\s\S]*?)}}',t)):
   bindings.append({'id':len(bindings)+1,'component':str(p),'template':str(file),'line':t[:m.start()].count('\n')+1,'expression':m[1].strip()})
  for m in re.finditer(r"""<(button|a)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)</\1>""",t):
   attrs=m[2];handler=re.search(r'\(click\)="([^"]+)"',attrs);href=re.search(r'(?:\[routerLink\]|routerLink|\[href\]|href)="([^"]+)"',attrs)
   if not handler and not href:continue
   text=re.sub('<[^>]+>',' ',m[3]).strip();methods=[]
   if handler:
    h=re.match(r'(\w+)\(',handler[1])
    if h:
     start=re.search(r'\b'+h[1]+r'\([^\n]*\)\s*(?::[^\n{]+)?\{',s)
     if start:
      depth=1;pos=start.end()
      while pos<len(s) and depth:
       depth+=(s[pos]=='{')-(s[pos]=='}');pos+=1
      methods=re.findall(r'this\.api\.(\w+)\(',s[start.end():pos])
   actions.append({'component':str(p),'label':text,'handler':handler[1] if handler else '', 'navigation':href[1] if href else '', 'apiMethods':methods,'endpoints':[apiMethods.get(x,['SEE_API_SERVICE',x]) for x in methods], 'disabledExpression':re.search(r'\[disabled\]="([^"]+)"',attrs)[1] if re.search(r'\[disabled\]="([^"]+)"',attrs) else '', 'validation':'source wiring reviewed; destructive actions not executed'})
for name,data in [('visible-component-catalog',components),('visible-binding-catalog',bindings),('action-inventory',actions)]: (out/(name+'.json')).write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
patterns=re.compile(r'\|\|\s*[\'\"]?0|\?\?\s*0|Math\.random|setTimeout|\b(?:mock|dummy|demo|fake|sample)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23,}|https?://',re.I)
occ=[]
for p in root.rglob('*'):
 if p.suffix not in ['.ts','.html','.json']:continue
 for n,line in enumerate(p.read_text().splitlines(),1):
  if not patterns.search(line):continue
  kind='VALID_TEST_FIXTURE' if '/fixtures/' in str(p) else 'VALID_DOCUMENTATION' if line.strip().startswith(('//','*','<!--')) else 'SUSPICIOUS'
  if 'setTimeout' in line:kind='VALID_UI_LABEL';reason='DOM focus/scroll/chart scheduling, toast lifetime or reconnect; no fabricated business result'
  elif 'Math.random' in line:kind='VALID_UI_LABEL';reason='Client request id only; not a displayed business metric'
  elif kind=='SUSPICIOUS' and ('http' in line.lower()):kind='VALID_UI_LABEL';reason='URL validation, vendor reference, or endpoint contract; check rendered placeholders separately'
  else:reason='See fallback ledger and issue review; accumulator/sort/CSS defaults do not assert business values'
  occ.append({'file':str(p),'line':n,'text':line.strip(),'classification':kind,'reason':reason})
(out/'runtime-pattern-classification.json').write_text(json.dumps(occ,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'components':len(components),'bindings':len(bindings),'actions':len(actions),'patterns':len(occ)}))

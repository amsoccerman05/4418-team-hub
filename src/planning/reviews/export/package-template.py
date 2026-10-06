"""Package the artifact-tool-authored template. This never authors slides or includes reference documents."""
import os, pathlib, zipfile, json, hashlib, re
from fontTools.ttLib import TTFont
build=pathlib.Path(os.environ['SR_EXPORT_BUILD_DIR'])
out=pathlib.Path(__file__).resolve().parent
with zipfile.ZipFile(build/'authored-template.pptx') as z:
 parts={name:z.read(name) for name in z.namelist()}
# Deduplicate repeated original background/logo bytes without changing their visual content.
media={}; renames={}
for name,data in list(parts.items()):
 if name.startswith('ppt/media/'):
  digest=hashlib.sha256(data).hexdigest()
  if digest in media:renames[name]=media[digest];del parts[name]
  else:media[digest]=name
for name,data in list(parts.items()):
 if name.endswith('.xml') or name.endswith('.rels'):
  text=data.decode('utf-8-sig')
  for old,new in renames.items():text=text.replace('/'+old,'/'+new)
  # All source metadata is template-only. No source records or private file paths.
  parts[name]=text.encode()
import base64
bundle={name:{'kind':'text','value':data.decode()} if name.endswith(('.xml','.rels')) else {'kind':'base64','value':base64.b64encode(data).decode()} for name,data in parts.items()}
(out/'template.generated.ts').write_text('// Generated from the artifact-tool authored template. Local staging only.\nexport const TEMPLATE_PARTS:Record<string,{kind:string;value:string}> = '+json.dumps(bundle,separators=(',',':'))+';\n')
metrics={}
for key,file in [('body','RedHatText-Regular-full.ttf'),('heading','RedHatDisplay-Black-full.ttf')]:
 f=TTFont(build/file);em=f['head'].unitsPerEm
 metrics[key]={str(k):round(f['hmtx'].metrics[v][0]/em,5) for k,v in f.getBestCmap().items()}
(out/'font-metrics.generated.ts').write_text('// Advance widths from the open-source Red Hat reference fonts.\nexport const FONT_METRICS:Record<string,Record<string,number>> = '+json.dumps(metrics,separators=(',',':'))+';\n')
print('Packaged',len(parts),'parts; brand assets',len(media))

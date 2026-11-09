import pathlib,hashlib,json,subprocess
root=pathlib.Path.cwd();out=root/'.factory/lifecycle-refinement/qa/distinct-copy'
files=[]
for folder in ['src','drizzle','public','scripts']:
 files.extend(p for p in (root/folder).rglob('*') if p.is_file() and not p.is_symlink())
for name in ['package.json','package-lock.json','next.config.ts','tsconfig.json','next-env.d.ts','vitest.config.ts','drizzle.config.ts','.env.example']:
 if (root/name).is_file():files.append(root/name)
rows=[{'path':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(set(files),key=lambda p:p.relative_to(root).as_posix())]
digest=hashlib.sha256(''.join(r['path']+'\0'+r['sha256']+'\n' for r in rows).encode()).hexdigest()
record={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'branch':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),'workspace':str(root),'sha256':digest,'fileCount':len(rows),'scope':'src/**, drizzle/**, public/**, scripts/**; package.json, package-lock.json, next.config.ts, tsconfig.json, next-env.d.ts, vitest.config.ts, drizzle.config.ts, .env.example. Relative POSIX lexical order; hash each raw file; final SHA256 of path + NUL + hex SHA256 + newline per file. Excludes QA/docs/build caches and unmerged companion in original checkout.'}
record['baseline']='00a32602d12fcf0056483b02ccb8c0713c33eb98'
record['task']='distinct copy and sequential editorial review'
(out/'source-files.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'source-fingerprint.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))

from pathlib import Path
import tempfile,shutil,json
root=Path.cwd(); target=Path(tempfile.mkdtemp(prefix='radar-plan-recovery-qa-'))
excluded={'.git','.factory','.data','node_modules','Users','.claude'}
def ignore(parent,names):
 return [n for n in names if n in excluded or n.startswith('.next') or n.startswith('.env') or n.endswith('.tsbuildinfo')]
shutil.copytree(root,target,dirs_exist_ok=True,ignore=ignore)
(target/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
(target/'.data').mkdir(exist_ok=True)
(target/'.data/media-plan-recovery-qa').symlink_to(root/'.data/media-plan-recovery-qa',target_is_directory=True)
(root/'.data/media-plan-recovery-qa/snapshot.json').write_text(json.dumps({'root':str(target)}))
print(target)

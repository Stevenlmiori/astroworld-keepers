"""Assemble the three *_template.html files from the fragments in this folder.
Run from anywhere:  python3 src/assemble.py
The fragments here are the SOURCE. The templates one level up are generated."""
import pathlib
SRC = pathlib.Path(__file__).resolve().parent
OUT = SRC.parent
head = (SRC / 'head.html').read_text()
def build(body, script, out, title=None):
    h = head if title is None else head.replace('<title>Astroworld Keepers</title>', f'<title>{title}</title>', 1)
    tpl = h + (SRC / body).read_text() + "\n<script>\nconst DATA=__KEEPER_DATA__;\n" + (SRC / script).read_text() + "</script>\n"
    (OUT / out).write_text(tpl); print(out, len(tpl), 'bytes')
build('body.html', 'script.js', 'template.html')
build('rank_body.html', 'rank_script.js', 'rankings_template.html', 'Astroworld Value Board')
build('draft_body.html', 'draft_script.js', 'draft_template.html', 'Astroworld Draft Room')

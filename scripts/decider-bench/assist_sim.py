"""Assist mode as production runs it: model label when confidence >= t, else the rule (heuristic85).

  DIR=results python assist_sim.py onejev-9b-q8-gpu   # reads DIR/<name>.jsonl and DIR/heuristic85.jsonl
"""
import os
DIR = os.environ.get("DIR", "results")
RULE = f"{DIR}/heuristic85.jsonl"
import json, sys, copy
import bench

def load(p):
    return {json.loads(l)["movie_id"]: json.loads(l) for l in open(p, encoding="utf-8")}

rule = load(RULE)
for name in sys.argv[1:]:
    model = load(f"{DIR}/{name}.jsonl")
    for t in (0.6, 0.7, 0.8, 0.9):
        recs = []
        for mid, r in model.items():
            h = {f["fid"]: f for f in rule[mid]["files"]}
            out = copy.deepcopy(r)
            longest = max(f["ms"] for f in out["files"])
            for f in out["files"]:
                if not (f["label"] and f["confidence"] >= t):
                    f.update(label=h[f["fid"]]["label"], confidence=0.0)
            res = {f["fid"]: f for f in out["files"]}
            for f in res.values():
                f.setdefault("probabilities", {})
                f["probabilities"].setdefault(f["label"], max(f["probabilities"].values(), default=1.0))
            bench.enforce_single_main(res)
            recs.append(out)
        path = f"{DIR}/_assist_{name}_{t}.tmp"
        with open(path, "w", encoding="utf-8") as fh:
            for r in recs:
                r["provider"] = f"assist:{name}@{t}"
                fh.write(json.dumps(r) + "\n")
        s = bench.score(path)
        acted = sum(1 for r in model.values() for f in r["files"] if f["label"] and f["confidence"] >= t)
        print(f"{s['provider']:<32} fve={s['feature_vs_extra']:.3f} strict={s['strict_3way']:.3f} "
              f"ver_recall={s['version_recall']:.3f} extra_recall={s['extra_recall']:.3f} "
              f"group={s['group_acc']:.3f} ver_group={s['version_group_acc']:.3f} model_acted={acted}")

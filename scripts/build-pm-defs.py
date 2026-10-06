"""새 파라메트릭 에디터(src/pm) 정의 데이터 생성 — 쿠지알러 에디터 조회 덤프를 한글 라벨과 함께 그대로 옮긴다.

  python scripts/build-pm-defs.py C:/workspace/snapit/kjl

입력(조회 GET 덤프, 쿠지알러 데이터는 바꾸지 않음):
  primitive-{cabinet,wardrobe,doorwindow,arch}.json — editor/api/site/primitive?tooltype= (요소·보조 구조 정의, 기본값·선택지)
  editor-api.json — functions(수식 함수 46), bizprop(업무 속성), extattr(변수 확장 속성)
출력: src/pm/defs.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kjl_ko import BIZ_KO, BT_KO, EL_KO, EXT_KO, FN_KO, OPT_KO, PROP_KO  # noqa: E402

FORMULA_NAME_KO = {'自定义截断规则': '사용자 절단 규칙', '自定义规则': '사용자 정의 규칙', '自定义公式': '사용자 정의 수식'}
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'C:/workspace/snapit/kjl')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'pm' / 'defs.json'
TOOLS = ['cabinet', 'wardrobe', 'doorwindow', 'arch']
SECTIONS = ['paramModels', 'moldingPaths', 'innerFrameModels', 'customDoorHoles', 'intersectBoxes', 'adsorbs',
            'connectors', 'connectorModels', 'wireLayouts', 'customAuxiliaries']
missing = set()


def ko(table, zh):
    if zh in table:
        return table[zh]
    if zh not in ('', None) and not zh.replace('.', '').isdigit():
        missing.add(zh)
    return zh


def bt_tree(lst):
    out = []
    for o in lst:
        n = {'name': ko(BT_KO, o['name']), 'value': o['value']}
        if o.get('children'):
            n['children'] = bt_tree(o['children'])
        out.append(n)
    return out


def param(p):
    out = {
        'name': p['paramName'], 'zh': p['displayName'], 'label': ko(PROP_KO, p['displayName']), 'type': p['valueType'],
        'value': p.get('value'), 'group': p.get('groupTypeId'), 'visible': p.get('visible', True),
    }
    if p.get('defaultValue') not in (None, ''):
        out['def'] = p['defaultValue']
    if p.get('editable') is False:
        out['editable'] = False
    if p.get('valueFormat'):
        out['format'] = p['valueFormat']
    if p.get('editorOptions'):
        out['options'] = [{'name': ko(OPT_KO, o['name']), 'zh': o['name'], 'value': o['value']} for o in p['editorOptions']]
    if p.get('editorRecommends'):
        out['recommends'] = p['editorRecommends']
    if p.get('businessTypeOptions'):
        out['btOptions'] = bt_tree(p['businessTypeOptions'])
    return out


def element_id(it):
    bt = it.get('businessType')
    return f"{it['functionName']}#{bt}" if bt is not None else it['functionName']


def main():
    elements, tools = {}, {}
    for tool in TOOLS:
        d = json.loads((SRC / f'primitive-{tool}.json').read_text(encoding='utf-8'))
        tools[tool] = {}
        for sec in SECTIONS:
            ids = []
            for it in d.get(sec) or []:
                eid = element_id(it)
                zh = it.get('businessName') or it.get('name')
                params = [param(p) for p in it['parameters']]
                if eid not in elements:
                    el = {'id': eid, 'fn': it['functionName'], 'section': sec, 'zh': zh, 'name': ko(EL_KO, zh), 'params': params}
                    if it.get('businessType') is not None:
                        el['businessType'] = it['businessType']
                        el['localeId'] = it.get('localeId')
                    elements[eid] = el
                else:
                    # 도구 종류마다 기본값만 다른 경우(몰드 클라우드 로프트·스윕의 기본 단면) — 차이만 기록
                    base = {p['name']: p for p in elements[eid]['params']}
                    diff = {p['name']: p['value'] for p in params if base.get(p['name'], {}).get('value') != p['value']}
                    if diff:
                        elements[eid].setdefault('toolValues', {})[tool] = diff
                ids.append(eid)
            tools[tool][sec] = ids
        tools[tool]['shapes'] = [{'id': s['profileId'], 'name': s['name'], 'height': s.get('height'), 'preview': s.get('previewImgUrl')}
                                 for s in d['resource']['shapes']]

    api = json.loads((SRC / 'editor-api.json').read_text(encoding='utf-8'))
    functions = []
    for f in api['functions']:
        info = json.loads(f.get('info') or '{}')
        functions.append({'name': f['functionName'], 'type': f.get('functionType'), 'desc': FN_KO.get(f['functionName'], info.get('introduction', '')),
                          'example': (info.get('example') or '').strip()})

    bp = api['bizprop']['d']
    biz = []
    for x in bp['paramBizProperties']:
        biz.append({
            'id': x['id'], 'key': x['propertyKey'], 'zh': x['propertyName'], 'name': ko(BIZ_KO, x['propertyName']), 'type': x['valueType'],
            'def': x.get('defaultValue'), 'formula': bool(x.get('formula')), 'tools': x.get('toolTypeWords') or [],
            # 수식 선택지 이름(业务属性 창의 마지막 라디오) — 의미 있는 이름만
            **({'formulaName': FORMULA_NAME_KO[x['formulaName']]} if x.get('formulaName') in FORMULA_NAME_KO else {}),
            'options': [{'name': ko(OPT_KO, o['name']) if o['name'] else '', 'zh': o['name'], 'value': o['value']}
                        for o in (x.get('optionValues') or []) if o.get('name') is not None],
        })
    ext = []
    for e in api['extattr']['d']:
        name, tip = EXT_KO.get(e['extAttributeName'], (e['extAttributeName'], e.get('tip') or ''))
        ext.append({'key': e['extAttributeKey'], 'zh': e['extAttributeName'], 'name': name, 'tip': tip, 'type': e.get('valueType'),
                    'def': e.get('defaultValue'), 'supportTypes': e.get('supportTypes'), 'inputBoxType': e.get('inputBoxType')})

    # 모델 자신(ParamModel.paramModel) · 모델 외곽 틀 · 하위 모델 인스턴스 공통 속성 — 실제 모델 editordata 에서
    ed = api['editordata']['editorData']
    model_def = {'id': ed['paramModel']['functionName'], 'fn': ed['paramModel']['functionName'], 'section': 'paramModel', 'zh': '模型', 'name': '모델',
                 'params': [param(p) for p in ed['paramModel']['parameters']]}
    fm = ed['frameModels'][0]
    frame_def = {'id': fm['functionName'], 'fn': fm['functionName'], 'section': 'frameModels', 'zh': '矩形外框', 'name': '사각 외곽 틀',
                 'params': [param(p) for p in fm['parameters']]}
    plank = {p['name']: p for p in elements['PrimitiveModel.plank']['params']}
    inst_names = [p['paramName'] for p in ed['modelInstances'][0]['parameters']]
    inst = [{'name': n, 'zh': z, 'label': ko(PROP_KO, z), 'type': 'float', 'value': f'#{n}', 'group': 0, 'visible': True}
            for n, z in (('W', '宽'), ('D', '深'), ('H', '高'))]
    inst += [plank[n] for n in inst_names if n in plank]
    instance_def = {'id': 'instance', 'fn': 'instance', 'section': 'modelInstances', 'zh': '部件', 'name': '부품', 'params': inst}

    out = {
        '_source': 'scripts/build-pm-defs.py ← 쿠지알러 editor/api/site 조회 덤프',
        'elements': list(elements.values()), 'model': model_def, 'frame': frame_def, 'instance': instance_def, 'tools': tools, 'functions': functions, 'bizProps': biz,
        'bizByCat': {k: v.get('editordata', []) for k, v in bp['prodCat2EditorDataBizProperties'].items()},
        'bizByFn': bp['prodCat2FunctionBizProperties'].get('-1', {}),
        'bizByParam': bp['prodCat2ParameterBizProperties'], 'extAttrs': ext,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT} ({OUT.stat().st_size // 1024} KB) 요소 {len(elements)} · 함수 {len(functions)} · 업무 속성 {len(biz)} · 확장 속성 {len(ext)}')
    if missing:
        print('번역 없음:', sorted(missing))


if __name__ == '__main__':
    main()

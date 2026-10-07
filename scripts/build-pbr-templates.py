"""쿠지알러 ‘실시간 재질 제작 도구’(实时材质制作工具) 조회 덤프 → HP3 public/pbr-templates.json

입력(로그인한 브라우저에서 읽기 전용 GET 으로 받아 둔 덤프, 2026-10-07)
  rme-templates-list.json   — mmus/api/physicaltexture/specialty/r?uploadtype=3&pos=2&version=4  (재질 템플릿 289종 목록)
  rme-templates-detail.json — mg/api/pbr/material?sceneid=<materialId>                           (템플릿마다 속성 스키마·기본값)
  rme-presets.json          — mg/api/pbr/presetimageslib?textype=…                               (맵 종류별 ‘시스템 맵’)
  + HP3 src/data/materialCategories.json (재질 한글 이름, id = obsPtextureId)

출력 public/pbr-templates.json — 편집기를 열 때만 불러온다(번들에 넣지 않음)
  cats      왼쪽 분류(catValue 순)
  templates 템플릿: id(obsPtextureId)·이름·분류·재질 공 이미지·기본 표시 모델·크기·속성 묶음(groups)
            묶음 { id(쿠지알러 matParamCategoryIdEnum), name, attrs[{ k(overridePath), t(종류), l(표시 이름), v(기본값), r(범위), o(선택지) }] }
  presets   맵 종류별 시스템 맵 [{ name, img }]

사용: python scripts/build-pbr-templates.py <덤프 폴더>
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'pbr-templates.json'

GROUP_KO = {
    '漫反射': '확산 반사', '反射': '반사', '折射': '굴절', '反射光泽度': '반사 광택도', '凹凸': '요철', '凹凸/法线': '요철/노멀',
    '自发光': '자체 발광', '菲涅耳': '프레넬', '不透明度': '불투명도', '透明度': '투명도', '置换': '변위', '折射光泽度': '굴절 광택도',
}
ATTR_KO = {
    '效果': '효과', '漫反射贴图': '확산 반사 맵', '漫反射颜色': '확산 반사 색', 'VR颜色': 'VR 색', '色相': '색조', '饱和度': '채도',
    '高级伽玛对比度': '고급 감마 대비', '高级亮度': '고급 밝기', '反射颜色': '반사 색', '反射贴图': '반사 맵', '亮度': '밝기',
    '光泽度贴图': '광택도 맵', '反射光泽度': '반사 광택도', '凹凸比例': '요철 비율', '凹凸贴图': '요철 맵', '颜色': '색',
    '折射贴图': '굴절 맵', '折射率': '굴절률', '发光贴图': '발광 맵', '发光能量': '발광 에너지', '菲涅耳': '프레넬',
    '菲涅耳折射率': '프레넬 굴절률', '不透明度贴图': '불투명도 맵', '不透明度': '불투명도', '置换比例': '변위 비율', '置换贴图': '변위 맵',
    '折射光泽度': '굴절 광택도', '折射光泽度贴图': '굴절 광택도 맵', '正面颜色': '정면 색', '侧面颜色': '측면 색', '正面': '정면', '侧面': '측면',
    '反射亮度': '반사 밝기', '反射光泽度亮度': '반사 광택도 밝기', '透明度贴图': '투명도 맵',
}
OPT_KO = {'贴图': '맵', '颜色': '색', '数值': '수치', '凹凸': '요철', '法线': '노멀'}
PRESET_KO = {
    '加州柚木': '캘리포니아 티크', '橡木': '오크', '水曲柳': '물푸레나무', '柚木': '티크', '拉丝凹凸': '헤어라인 요철', '划痕': '긁힘',
    '正铺': '일자 붙임', '鱼骨铺': '피시본 붙임', '风车铺': '바람개비 붙임', '跳格': '격자 건너뛰기', '布料折皱': '천 주름',
    '工字铺': '엇갈림(I자) 붙임', '人字铺': '헤링본 붙임', '墙面凹凸': '벽면 요철', '瓷砖凹凸': '타일 요철',
}


def preset_name(zh):
    if zh in PRESET_KO:
        return PRESET_KO[zh]
    for pat, ko in ((r'^布纹(\d+)$', '직물 무늬 {}'), (r'^石材(\d+)$', '석재 {}'), (r'^木纹(\d+)$', '나뭇결 {}'), (r'^预[置设]贴图(\d+)$', '프리셋 맵 {}')):
        m = re.match(pat, zh)
        if m:
            return ko.format(m.group(1))
    raise SystemExit(f'시스템 맵 이름 번역 없음: {zh}')


def color(v):
    return [round(float(v.get('x', 0)), 6), round(float(v.get('y', 0)), 6), round(float(v.get('z', 0)), 6)]


def attr(a, missing):
    bv = a['basicValue']
    t = bv['type']
    zh = (a.get('displayInfo') or {}).get('displayName') or a['overridePath']
    ko = ATTR_KO.get(zh)
    if ko is None:
        missing.add(zh)
        ko = zh
    out = {'k': a['overridePath'], 't': t, 'l': ko}
    v = bv.get('value')
    if t == 'Option':
        out['v'] = v.get('value') if isinstance(v, dict) else v
        out['o'] = [[OPT_KO.get(o['name'], o['name']), o.get('overridePath'), o.get('value')] for o in bv.get('optionValueList') or []]
    elif t in ('AColor', 'Color'):
        out['v'] = color(v or {})
    elif t == 'Float':
        out['v'] = v
        r = bv.get('range')
        if r:
            out['r'] = [r.get('min'), r.get('max')]
    else:
        out['v'] = v
    return out


def main():
    lst = json.loads((SRC / 'rme-templates-list.json').read_text(encoding='utf-8'))['returnList']
    det = json.loads((SRC / 'rme-templates-detail.json').read_text(encoding='utf-8'))
    pre = json.loads((SRC / 'rme-presets.json').read_text(encoding='utf-8'))
    cats_hp3 = json.loads((ROOT / 'src' / 'data' / 'materialCategories.json').read_text(encoding='utf-8'))
    ko_name = {it['id']: it['name'] for g in cats_hp3 for it in g['items']}
    ko_group = {g['zh']: g['name'] for g in cats_hp3}

    missing = set()
    cats = {}
    templates = []
    for t in sorted(lst, key=lambda x: (x.get('ptextureOrder', 9999), lst.index(x))):
        d = det.get(t['materialId']) or {}
        groups = []
        for c in d.get('attributeCategories') or []:
            zh = c.get('categoryName')
            gid = c.get('categoryId')
            groups.append({
                'id': gid if gid is not None else -1,
                'name': GROUP_KO.get(zh, zh),
                'attrs': [attr(a, missing) for a in c.get('attributeInfoSet') or []],
            })
            if zh not in GROUP_KO:
                missing.add(zh)
        cats[t['catValue']] = {'v': t['catValue'], 'zh': t['baseCategory'], 'name': ko_group.get(t['baseCategory'], t['baseCategory'])}
        pbr = (d.get('pbrJson') or {}).get('parameters') or {}
        nrm = pbr.get('normal')
        sc = d.get('scale') or {'x': 1000, 'y': 1000}
        item = {
            'id': t['obsPtextureId'], 'name': ko_name.get(t['obsPtextureId'], t['name'].strip()), 'zh': t['name'].strip(),
            'cat': t['catValue'], 'ball': t.get('sceneImage') or '', 'model': t.get('defaultModelType', 0),
            'scale': [sc.get('x', 1000), sc.get('y', 1000)], 'shader': (d.get('pbrJson') or {}).get('shaderName', 'VRayMtl'),
            'groups': groups,
        }
        if isinstance(nrm, dict) and nrm.get('value'):
            item['normal'] = nrm['value']
        # 스키마에 프레넬 묶음이 없는 템플릿(천 등)은 V-Ray 원본 값으로 미리보기
        if not any(a['k'] == 'fresnel' for g in groups for a in g['attrs']):
            fr = pbr.get('fresnel') or {}
            fi = pbr.get('fresnel_ior') or {}
            item['vray'] = {'fresnel': bool(fr.get('value', True)), 'fresnelIor': float(fi.get('value', 1.6))}
        templates.append(item)
    presets = {k: [{'name': preset_name(x['name']), 'img': x['previewImg']} for x in (v.get('dataList') or [])] for k, v in pre.items() if (v.get('dataList') or [])}
    if missing:
        raise SystemExit(f'번역 없음: {sorted(missing)}')
    out = {
        'note': '쿠지알러 실시간 재질 제작 도구 템플릿(읽기 전용 GET 덤프, 2026-10-07) — scripts/build-pbr-templates.py 로 만듦',
        'cats': [cats[k] for k in sorted(cats)],
        'templates': templates,
        'presets': presets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT.name} — 템플릿 {len(templates)}개, 분류 {len(cats)}개, 시스템 맵 {sum(len(v) for v in presets.values())}장 ({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()

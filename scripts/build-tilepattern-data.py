"""쿠지알러 조회 덤프 → HP3 ‘타일 배열 패턴’(拼砖样式) 정적 데이터.

출력
  src/data/tilePatterns.json — 붙임 방식 템플릿 94종: 이름(한글·원문)·미리보기·크기 항목·타일 칸

입력(로그인한 브라우저에서 읽기 전용 GET 으로 받아 둔 덤프)
  tilepattern-all.json — deco_cms/api/tilepattern/templates (목록) + tilepattern/template/detail?templateid= (상세)를 합친 것

사용: python scripts/build-tilepattern-data.py <덤프 폴더>
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'tilePatterns.json'

# 템플릿 이름 낱말 (긴 것부터 바꾼다)
NAME_KO = {
    '星形砖-圆角砖': '별 타일-둥근 모서리', '大砖嵌小三角砖': '큰 타일+작은 삼각 타일', '风车铺嵌小砖': '바람개비+작은 타일',
    '三角形嵌小砖': '삼각형+작은 타일', '大砖嵌小砖': '큰 타일+작은 타일', '东易日盛定制铺': 'DYRS 맞춤 붙임', '双拼工字铺': '2장 엇갈림 붙임',
    '平行错位': '평행 어긋남', '紧紧相依': '맞붙임', '三角形铺法': '삼각형 붙임', '星光璀璨': '별빛', '三位一体': '삼위일체',
    '交错铺': '엇갈림 붙임', '横竖拼': '가로세로 맞춤', '风车铺': '바람개비 붙임', '人字拼': '헤링본', '梯子铺': '사다리 붙임',
    '平行铺': '평행 붙임', '井字铺': '#자 격자 붙임', '立体砖': '입체 타일', '间隔铺': '간격 붙임', '错位铺': '어긋남 붙임',
    '编织铺': '바구니 짜임 붙임', '鱼骨拼': '피시본', '魔方': '큐브', '矩形': '직사각형',
}
# 크기 항목 이름 (쿠지알러 화면의 라벨 문구는 미확인 — 항목 뜻대로 붙임)
SIZE_KO = {
    'tileSize': '타일 크기', 'longSideSize': '긴 변', 'shortSideSize': '짧은 변', 'largeTileSize': '큰 타일', 'smallTileSize': '작은 타일',
    'smallSize': '작은 타일 변', 'longSize': '긴 변', 'shortSize': '짧은 변', 'shortSize1': '짧은 변 1', 'shortSize2': '짧은 변 2',
    'bigSize': '큰 타일 변', 'straightEdge': '직선 변', 'arcHigh': '호 높이', 'unitSize': '단위 크기', 'firstTileSize': '1번 타일 크기',
    'secondTileSize': '2번 타일 크기',
}
ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']


def ko_name(zh: str) -> str:
    s = zh
    for k in sorted(NAME_KO, key=len, reverse=True):
        s = s.replace(k, NAME_KO[k])
    s = re.sub(r'(?<=[가-힣)])(\d)', r' \1', s)  # ‘헤링본1’ → ‘헤링본 1’
    if re.search(r'[一-鿿]', s):
        raise SystemExit(f'번역 안 된 이름: {zh} → {s}')
    return s


def slot_label(name: str) -> str:
    m = re.match(r'([a-z]+)Tile$', name)
    if m and m.group(1) in ORD:
        return f'{ORD.index(m.group(1)) + 1}번 타일'
    return name


def main():
    raw = json.loads((SRC / 'tilepattern-all.json').read_text(encoding='utf-8'))
    if isinstance(raw, str):
        raw = json.loads(raw)
    out = []
    for t in raw:
        sizes = []
        for s in t.get('tileSize') or []:
            if s['name'] not in SIZE_KO:
                raise SystemExit(f'모르는 크기 항목: {s["name"]} ({t["name"]})')
            sizes.append({'key': s['name'], 'label': SIZE_KO[s['name']], 'value': int(s['value'])})
        out.append({
            'id': t['id'], 'name': ko_name(t['name']), 'zh': t['name'],
            'img': (t.get('detailImg') or t['previewImgUrl']).replace('http://', 'https://'),
            'cat': t['defaultPatternCategory'], 'sizes': sizes,
            'slots': [{'key': p['name'], 'label': slot_label(p['name']), 'shaped': p.get('shaped', False)} for p in t.get('params') or []],
        })
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(OUT.parent.parent.parent)} — 템플릿 {len(out)}개')


if __name__ == '__main__':
    main()

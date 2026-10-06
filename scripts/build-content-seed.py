"""쿠지알러 기업 상품 라이브러리 조회 덤프 → HP3 컨텐츠 라이브러리 시드(public/content-library-seed.json).

입력(브라우저에서 읽기 전용 GET 으로 받아 둔 덤프):
  api-1.json        — 태그 그룹(customtag), 브랜드(brands/v2), 권한 브랜드(authorized/brands), 사용자 정의 필드(customfield)
  api-folders.json  — 라이브러리별 폴더 트리(businesscat) + 말단 폴더별 상품 샘플(brandgood/enterprise?catid=)
  api-seed.json     — 상품이 없는 라이브러리의 폴더 트리 보충

사용: python scripts/build-content-seed.py <덤프 폴더>
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT = Path(__file__).resolve().parent.parent / 'public' / 'content-library-seed.json'

# 렌더 분류(prodCatName) 중국어 → 한글
RENDER_CAT = {
    '全屋定制材质': '맞춤가구 재질', '地板': '바닥재', '踢脚线': '걸레받이', '仿古砖': '앤티크 타일', '其它': '기타', '其他': '기타',
    '角线': '코너 몰딩', '书柜': '책장', '其他组合': '기타 조합', '扣板': '천장판', '大理石瓷砖': '대리석 타일', '电视柜': 'TV장',
    '多人沙发': '다인 소파', '书桌': '책상', '餐桌': '식탁', '斗柜': '서랍장', '床组合': '침대 조합', '单人床': '싱글 침대',
    '瓷片': '벽 타일', '床垫': '매트리스', '梳妆台': '화장대', '抱枕/靠垫': '쿠션', '茶几/茶座': '거실 테이블', '餐椅': '식탁 의자',
    '靠背椅': '등받이 의자', '板岩': '슬레이트', '软装材质': '패브릭 재질', '床头柜': '협탁', '微晶石': '결정화 석재',
    '美容椅': '미용 의자', '试衣镜': '전신 거울', '高低床/母子床': '2층 침대', '装饰线条': '장식 몰딩', '双人床': '더블 침대',
    '化妆镜': '화장 거울', '沙发组合': '소파 조합', '门芯': '도어 패널', '家具': '가구', '置物架': '선반', '餐桌组合': '식탁 조합',
    '凳子': '스툴', '壁柜': '벽장', '实木地板': '원목 마루', '空调': '에어컨', '儿童床': '아동 침대', '床': '침대', '边几': '사이드 테이블',
    '镜子': '거울', '书桌组合': '책상 조합', '图案': '패턴', 'L型转角沙发': 'L형 코너 소파',
}
MATERIAL_CAT = {
    '涂料/乳胶漆（哑光）': '도료/수성(무광)', '涂料/乳胶漆(哑光)': '도료/수성(무광)', '涂料/乳胶漆（高光）': '도료/수성(유광)',
    '石材/石英石': '석재/쿼츠', '瓷砖/仿古砖': '타일/앤티크', '瓷砖/水泥砖': '타일/시멘트', '石材/大理石': '석재/대리석',
    '瓷砖/哑面砖': '타일/무광', '板材/覆膜无压纹（高光）': '보드/필름(유광)', '扣板/V-发光材质': '천장판/발광',
}
FOLDER_NAME = {'未分类': '미분류', '新类目': '새 폴더'}
LOCATION = {1: '바닥 가구', 6: '벽면 부착', 12: '천장 부착'}

# 폴더 트리를 가져올 라이브러리 → 덤프 키
TREE_LIBS = [1, 39, 3, 112, 4, 7, 9, 10, 11, 13, 23, 33, 99, 81, 78]


def load(name):
    p = SRC / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}


def trim_tree(nodes):
    out = []
    for n in nodes or []:
        out.append({
            'id': n['obsId'],
            'name': FOLDER_NAME.get(n['name'], n['name']),
            **({'hidden': True} if n.get('hide') else {}),
            **({'cover': n['cover']} if n.get('cover') else {}),
            **({'children': trim_tree(n['children'])} if n.get('children') else {}),
        })
    return out


def item(x, lib, folder):
    e = x.get('tableModelExtendInfo') or {}
    bb = e.get('boundingBox') or {}
    return {
        'id': x['obsBrandGoodId'],
        'name': x['name'],
        'img': x.get('coverImage') or x.get('previewImage') or '',
        'lib': lib,
        'folder': folder,
        'code': e.get('brandGoodCode') or '',
        'model': e.get('productNumber') or '',
        'brandId': e.get('obsBrandId') or '',
        'brand': e.get('brandName') or '',
        'seriesId': e.get('obsSeriesTagId') or '',
        'series': e.get('seriesTagName') or '',
        'renderCat': RENDER_CAT.get(e.get('prodCatName'), e.get('prodCatName') or ''),
        'location': LOCATION.get(e.get('locationId'), ''),
        'size': e.get('dimensions') or '',
        'modelSize': bb.get('copy') or '',
        'sizeLock': bool(e.get('sizeLock')),
        'material': MATERIAL_CAT.get(e.get('materialCategoryName'), e.get('materialCategoryName') or ''),
        'price': e.get('price') if isinstance(e.get('price'), (int, float)) else None,
        'buyLink': e.get('buyLink') or '',
        'appletLink': e.get('appletLink') or '',
        'description': e.get('description') or '',
        'tags': e.get('customTags') or [],
        'creator': e.get('creator') or '',
        'created': x.get('created'),
        'modified': x.get('lastModified'),
        'visible': bool(x.get('visible')),
        'panorama': True,
        'public': bool(e.get('public')),
        'kupinshow': bool(e.get('existModelViewer')),
        'top': bool(x.get('top')),
        'renderState': 'done' if x.get('ready') else 'running',
        'synced': [s['name'] for s in x.get('syncData') or []],
    }


def main():
    a1, af, aseed = load('api-1.json'), load('api-folders.json'), load('api-seed.json')
    trees = {}
    for lib in TREE_LIBS:
        cats = (af.get(str(lib)) or {}).get('cats') or (aseed.get(str(lib)) or {}).get('cats') or []
        trees[lib] = trim_tree(cats)

    items, seen = [], set()
    for lib, v in af.items():
        for folder, f in (v.get('items') or {}).items():
            for x in f['list']:
                if x['obsBrandGoodId'] in seen:
                    continue
                seen.add(x['obsBrandGoodId'])
                items.append(item(x, int(lib), folder))

    tag_groups = [{'id': g['obsKeyId'], 'name': g['name'], 'single': bool(g.get('single')),
                   'tags': [t['name'] for t in g['tags']]} for g in a1.get('customtag', [])]
    brands = [{'id': b['obsBrandId'], 'name': b['brandName'], 'logo': b.get('logo', ''),
               'series': [{'id': s['obsSeriesTagId'], 'name': s['seriesTagName']} for s in b.get('brandSeries', [])]}
              for b in a1.get('brands', [])]
    partners = [{'account': p['accountName'], 'brands': [b['brandName'] for b in p.get('obsBrands', [])]}
                for p in (a1.get('authBrands') or {}).get('d', [])]
    fields = [{'id': f['obsFieldId'], 'name': f['fieldName'], 'description': f.get('description', '')}
              for f in ((a1.get('customfield') or {}).get('d') or {}).get('data', []) if not f.get('deleted')]

    seed = {'version': 1, 'source': 'kujiale brandgoods (read-only dump)', 'trees': trees, 'items': items,
            'tagGroups': tag_groups, 'brands': brands, 'partners': partners, 'customFields': fields}
    OUT.write_text(json.dumps(seed, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT} — items {len(items)}, tag groups {len(tag_groups)}, brands {len(brands)}, '
          f'{OUT.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()

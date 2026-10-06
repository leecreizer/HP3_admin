"""쿠지알러 파라메트릭 모델 에디터(参数化模型编辑器) 명세서 → public/kujiale-param-editor-spec.html

새 HP3 파라메트릭 에디터를 '지어내지 않고' 만들기 위한 기준 문서.
- 표(요소·보조 구조 속성, 선택지, 업무 속성, 수식 함수)는 쿠지알러 정의 데이터에서 그대로 생성한다.
- 화면 구성·메뉴·대화상자는 2026-10-06 기존 모델을 열어 '보기만' 하고 확인한 내용이다.

입력(로그인한 브라우저에서 읽기 전용 GET 으로 받아 둔 덤프 + 화면 캡처)
  editor-api.json — editor/api/site/{editordata(doupdate=false), primitive, expression/functions, bizprop, extattr}
  sp-*.png        — 에디터 화면 캡처 (18T 오픈장 선반(D150)-副本, tooltype=cabinet)

사용: python scripts/build-editor-spec.py <덤프 폴더>
"""
import html
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'kujiale-param-editor-spec.html'
CAP = ROOT / 'public' / 'captures' / 'kujiale-param-editor'

E = html.escape

from kjl_ko import BIZ_KO, ED_KEYS, EL_KO, FN_KO, GROUP_KO, OPT_KO, PROP_KO, SECTION_KO, VT_KO  # noqa: E402

CAPTURES = {  # 원본 → 문서용 이름
    'sp-00-open.png': '01-editor.jpg', 'sp-menus.png': '02-menus.jpg', 'sp-dlg2-keys.png': '03-shortcuts.jpg',
    'sp-sel-panels.png': '04-props.jpg', 'sp-profile-editor.png': '05-profile-editor.jpg', 'sp-dlg-biz.png': '06-biz-props.jpg',
    'sp-dlg-output.png': '07-data-output.jpg', 'sp-dlg2-refs.png': '08-diagnosis.jpg', 'sp-global-vars.png': '09-global-vars.jpg',
    'sp-page-config.png': '10-settings.jpg', 'sp-dlg2-versions.png': '11-versions.jpg',
}


def ko(d, zh):
    return d.get(zh, zh)


def cell(zh, d):
    k = ko(d, zh)
    return E(k) if k == zh else f'{E(k)} <small>{E(zh)}</small>'


def copy_captures():
    CAP.mkdir(parents=True, exist_ok=True)
    for src, dst in CAPTURES.items():
        p = SRC / src
        if not p.exists():
            continue
        im = Image.open(p).convert('RGB')
        if im.width > 1600:
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        im.save(CAP / dst, 'JPEG', quality=82, optimize=True)


def fig(name, cap):
    return f'<figure class="shot"><img src="captures/kujiale-param-editor/{name}" alt="{E(cap)}"><figcaption>{E(cap)}</figcaption></figure>'


def element_tables(prim):
    out = []
    for key in ['paramModels', 'moldingPaths', 'innerFrameModels', 'customDoorHoles', 'intersectBoxes', 'adsorbs', 'connectors', 'wireLayouts', 'connectorModels', 'customAuxiliaries']:
        for el in prim.get(key) or []:
            name = el.get('name') or el.get('displayName') or ''
            rows = []
            for p in sorted(el.get('parameters') or [], key=lambda p: (p.get('groupTypeId', 9), )):
                if not p.get('visible'):
                    continue
                opts = [o.get('name') if isinstance(o, dict) else str(o) for o in (p.get('editorOptions') or [])]
                rows.append(
                    f"<tr><td>{cell(p.get('displayName') or '', PROP_KO)}</td><td><code>{E(p.get('paramName') or '')}</code></td>"
                    f"<td>{E(VT_KO.get(p.get('valueType'), p.get('valueType') or ''))}</td><td>{E(GROUP_KO.get(p.get('groupTypeId'), str(p.get('groupTypeId'))))}</td>"
                    f"<td>{E(' / '.join(ko(OPT_KO, o) for o in opts))}</td></tr>")
            out.append(
                f'<h4>{cell(name, EL_KO)} <small class="fn">{E(el.get("functionName") or "")} · {E(SECTION_KO.get(key, key))}</small></h4>'
                '<div class="tblwrap"><table class="spec"><tr><th>속성</th><th>참조명</th><th>값 형식</th><th>패널 묶음</th><th>선택지</th></tr>'
                + ''.join(rows) + '</table></div>')
    return '\n'.join(out)


def biz_table(bp):
    rows = []
    for b in bp:
        opts = ' / '.join(ko(OPT_KO, o.get('name') or '') for o in (b.get('optionValues') or []) if o.get('name'))
        desc = (b.get('optionValues') or [{}])[0].get('desc') or b.get('propertyDesc') or ''
        rows.append(f"<tr><td title=\"{E(desc)}\">{cell(b['propertyName'], BIZ_KO)}</td><td><code>{E(b.get('propertyKey') or '')}</code></td>"
                    f"<td>{E(VT_KO.get(b.get('valueType'), b.get('valueType') or ''))}</td><td>{E(opts)}</td><td>{E(str(b.get('defaultValue') if b.get('defaultValue') is not None else ''))}</td></tr>")
    return ('<div class="tblwrap"><table class="spec"><tr><th>업무 속성</th><th>키</th><th>값 형식</th><th>선택지</th><th>기본값</th></tr>'
            + ''.join(rows) + '</table></div>')


def fn_table(fns):
    rows = []
    for f in fns:
        try:
            info = json.loads(f.get('info') or '{}')
        except ValueError:
            info = {}
        ex = (info.get('example') or '').strip()
        rows.append(f"<tr><td><code>{E(f['functionName'])}</code></td><td>{E(FN_KO.get(f['functionName'], info.get('introduction', '')))}</td><td><code>{E(ex[:90])}</code></td></tr>")
    return '<div class="tblwrap"><table class="spec"><tr><th>함수·연산</th><th>뜻</th><th>쿠지알러 예시</th></tr>' + ''.join(rows) + '</table></div>'


def keys_table(ed):
    rows = []
    for k in sorted(ed.keys()):
        v = ed[k]
        n = len(v) if isinstance(v, (list, dict)) else ('' if v is None else v)
        rows.append(f"<tr><td><code>{E(k)}</code></td><td>{E(ED_KEYS.get(k, '미확인'))}</td><td>{E(str(n))}</td></tr>")
    return '<div class="tblwrap"><table class="spec"><tr><th>키</th><th>뜻</th><th>예시 모델 값 수</th></tr>' + ''.join(rows) + '</table></div>'


STYLE = (ROOT / 'public' / 'kujiale-brandgoods-analysis.html').read_text(encoding='utf-8').split('<style>')[1].split('</style>')[0]
STYLE += 'h4 small.fn{font-weight:400;color:var(--ink-faint);font-size:11.5px;margin-left:6px} td small{color:var(--ink-faint);margin-left:4px}\n'


def main():
    api = json.loads((SRC / 'editor-api.json').read_text(encoding='utf-8'))
    prim, fns = api['primitive'], api['functions']
    bp = api['bizprop']['d']['paramBizProperties']
    ed = api['editordata']['editorData']
    copy_captures()
    n_el = sum(len(prim.get(k) or []) for k in SECTION_KO)

    body = f'''
<header class="doc">
  <div class="eyebrow">명세 · 새 파라메트릭 에디터 기준</div>
  <h1>쿠지알러 파라메트릭 모델 에디터 명세</h1>
  <p class="sub">HP3 어드민의 파라메트릭 에디터를 새로 만들 때 따를 기준입니다. 표는 쿠지알러 정의 데이터에서 그대로 만들었고, 화면 구성은 기존 모델을 열어 <b>보기만</b> 하고 확인했습니다. 확인하지 못한 동작은 ‘미확인’으로 남겼습니다.</p>
  <table class="meta">
    <tr><th>대상</th><td>쿠지알러 参数化模型编辑器 (<code>/vc/modeleditor/new?tooltype=cabinet&amp;obsbrandgoodid=…</code>), HANSSEM 계정</td></tr>
    <tr><th>확인 모델</th><td>반제품 라이브러리 ‘18T 오픈장 선반(D150)-副本’ (판재 1·윤곽 제한 2·외곽 틀)</td></tr>
    <tr><th>조사</th><td>2026-10-06 — 정의 데이터 조회(GET) + 화면 보기. 값 수정·저장·입고·확인 버튼은 누르지 않았고, 닫은 뒤 모델 버전(versionId 0)·수정 시각이 그대로인 것을 조회로 확인</td></tr>
    <tr><th>근거 표기</th><td><span class="pill good">데이터</span> 정의 데이터 그대로 · <span class="pill info">화면</span> 화면에서 확인 · <span class="pill warn">미확인</span> 동작을 확인하지 못함</td></tr>
  </table>
</header>

<section id="layout">
  <h2><span class="no">1</span>화면 구성 <span class="pill info">화면</span></h2>
  {fig('01-editor.jpg', '기존 모델을 연 화면 — 상단 도구 막대 · 왼쪽 파라미터 설정 · 가운데 3D · 구조 탐색 · 오른쪽 속성')}
  <div class="tblwrap"><table class="spec">
    <tr><th>영역</th><th>구성</th></tr>
    <tr><td>상단 도구 막대</td><td>실행 취소 · 다시 실행 · 비우기 | 변수&amp;속성 ▾ · 도구 ▾ · 조작 ▾ · 검증 ▾ · 플러그인 ▾ | ‘여기서 변수 위치 검색’ | 새 기능 ▾ · 도움말 ▾ · 파일 ▾ · 설정</td></tr>
    <tr><td>왼쪽 패널 (탭 3)</td><td>파라미터 설정 · 요소 라이브러리 · 부품 라이브러리 (왼쪽 패널 접기 = <code>~</code>)</td></tr>
    <tr><td>가운데 3D</td><td>격자 바닥 + XYZ 축, 아래 도구: 2D ▾ · 3D ▾ · 숨김 보기(눈) · 보조 구조 · 진단(!) · 분해 거리 막대. 오른쪽 위 토글: 모델 진단 패널 · 구조 탐색 패널</td></tr>
    <tr><td>구조 탐색 (떠 있는 패널)</td><td>모델 이름 아래 묶음: 부품 · 모델 외곽 틀 · 윤곽 제한 · 흡착선 · 내부 공간 · 문 개구부 · 간섭 영역 · 연결 부품 · 사용자 정의 구조. 항목마다 눈 아이콘(보기 숨김). 누르면 선택</td></tr>
    <tr><td>오른쪽 속성 패널</td><td>선택 없음 = 모델 속성(3절), 요소·보조 구조 선택 = 그 정의의 속성(5절). 모든 값 칸은 수식 입력(계산기 아이콘), 재질은 ‘참조’ + 변수(<code>#CZ</code>)</td></tr>
  </table></div>
</section>

<section id="menus">
  <h2><span class="no">2</span>메뉴 · 단축키 <span class="pill info">화면</span></h2>
  {fig('02-menus.jpg', '도구 · 조작 · 검증 · 플러그인 · 도움말 · 파일 메뉴를 펼친 모습')}
  <div class="tblwrap"><table class="spec">
    <tr><th>메뉴</th><th>항목 (단축키)</th><th>열리는 것</th></tr>
    <tr><td>변수&amp;속성</td><td>전역 변수 · 변수 계열 · 업무 속성 · 견적 설정(Alt+B) · 데이터 출력 설정(Alt+S)</td><td>전역 변수 = 별도 관리 페이지(9절) · 변수 계열 = 떠 있는 패널(‘변수 계열 없음 / 변수 계열 가져오기’) · 나머지 = 대화상자(7절)</td></tr>
    <tr><td>도구</td><td>극속 모델링 · 문 개구부 연결(Alt+M) · 부품 노드 보고 설정 · 환경 조건</td><td>극속 모델링·문 개구부 연결은 모델을 바꾸므로 열지 않음 <span class="pill warn">미확인</span> · 나머지 = 대화상자</td></tr>
    <tr><td>조작</td><td>숨김 → 억제 전환 ▸ (하위 메뉴) · 부품 동명 변수 참조</td><td>모델을 바꾸므로 열지 않음 <span class="pill warn">미확인</span></td></tr>
    <tr><td>검증</td><td>모델 진단 · 참조 보기</td><td>진단 = 떠 있는 패널(성능·간섭) · 참조 보기 = 모델 의존 그래프 페이지(새 탭)</td></tr>
    <tr><td>플러그인</td><td>플러그인 불러오기 · 내려받기 · 닫기</td><td><span class="pill warn">미확인</span></td></tr>
    <tr><td>도움말</td><td>모델링 교육 · 단축키 · 설문 피드백 · 로컬 로그 업로드</td><td>단축키 = 대화상자</td></tr>
    <tr><td>파일</td><td>새로 만들기 · 열기 · 저장(Ctrl+S) · 저장 후 입고(Ctrl+Alt+S) · 다른 이름으로 저장(Ctrl+Shift+S) · 모델 버전</td><td>새로 만들기·열기 = 모델 유형 선택 창(분석 문서 3-2절) · 모델 버전 = 대화상자</td></tr>
    <tr><td>설정</td><td>(아이콘)</td><td>파라메트릭 모델링 설정 페이지(새 탭, 9절)</td></tr>
  </table></div>
  {fig('03-shortcuts.jpg', '단축키 창')}
  <div class="tblwrap"><table class="spec">
    <tr><th>구분</th><th>단축키</th></tr>
    <tr><td>삽입</td><td>평면 판재 Shift+P · 경사 절단 스윕 Shift+O · 모서리형 판재 Shift+U · 로프트 Shift+F · 스윕 Shift+S · 융합 Shift+R · 격자 Shift+W · 윤곽 제한 Shift+L · 직선 흡착 Shift+X · 직각 흡착 Shift+Z · 흡착 윤곽 Shift+K · 사각 내부 공간 Shift+N · 문 개구부 Shift+M · 충돌(간섭) 영역 Shift+C · 배관 연결구 Shift+G</td></tr>
    <tr><td>기능</td><td>왼쪽 패널 전환 ~ · 문 개구부 연결 Alt+M · 표시/숨김 H · 데이터 출력 Alt+S · 교체 C · 견적 출력 Alt+B · 배열 A · 배열 해제 Ctrl+Shift+A</td></tr>
    <tr><td>편집</td><td>실행 취소 Ctrl+Z · 다시 실행 Ctrl+Shift+Z · 저장 Ctrl+S · 다른 이름으로 저장 Ctrl+Shift+S · 복제 Ctrl+V · 비우기 Ctrl+E · 삭제 Delete</td></tr>
    <tr><td>표시</td><td>재질 Ctrl+1 · 재질+와이어프레임 Ctrl+2 · 투명 Ctrl+3 · 흰색 Ctrl+4 · 2D 위/아래 T/B · 왼/오른 L/R · 앞/뒤 F/K · 3D 전환 V</td></tr>
  </table></div>
  <p class="note gap"><b>미확인</b>‘융합(Shift+R)’ 요소는 단축키에는 있으나 주방·욕실(cabinet) 요소 목록에는 없습니다. 이 모델의 도구 메뉴에는 ‘배열’이 없고 단축키 A 로만 있습니다.</p>
</section>

<section id="model-props">
  <h2><span class="no">3</span>모델 속성 (선택 없음) <span class="pill info">화면</span></h2>
  <div class="tblwrap"><table class="spec">
    <tr><th>묶음</th><th>항목</th></tr>
    <tr><td>상품</td><td>상품 이름 · 상품 상세 보기 · 모델 열기</td></tr>
    <tr><td>이미지 설정</td><td>미리보기 이미지 [만들기] · 표기도 [만들기]</td></tr>
    <tr><td>부품 속성 › 기본 속성</td><td>소속 라이브러리 (<b>여러 개</b> — 예: 일반 부품·반제품·부품 모드·내부 부품) · 모델 유형 [변경] · 부품 호출 방식</td></tr>
    <tr><td>프론트 사용 속성</td><td>모델 교체 시 상속 속성 [선택] · 상판 생성 · 상부 몰딩 생성 · 걸레받이 생성 · 조명 몰딩 생성 · 부품 삭제 가능 · 부품 교체 가능 · 가상 모델 삽입 · 전체 인식 · 부품 변수 편집 가능 · 텍스처 통일 · 미닫이문 생성 · 내부 간섭 무시 · 숨김 변수 전달 · 시스템 변수 로직 · 수정 가능 변수 [선택] · 간섭 검사 영역 · 교체 가능 · 부품 내부 공간 맞춤 로직</td></tr>
    <tr><td>도구 설정</td><td><span class="pill warn">미확인</span> (패널 아래쪽)</td></tr>
  </table></div>
</section>

<section id="params">
  <h2><span class="no">4</span>파라미터 설정 (왼쪽 1번 탭) <span class="pill info">화면</span></h2>
  <ul>
    <li><b>시스템 변수</b> (접힘) · <b>기본 변수</b> 표: 이름 · 참조명 · 현재값 — 예: 너비 W 600 · 깊이 D 500 · 높이 H 18 · 재질 CZ(재질 견본)</li>
    <li><b>사용자 정의 변수</b> (아이콘: 숨김 보기 · 가져오기 · 내보내기 · 추가) — 예: 코드 <code>CODE</code> = <code>#W==864 AND #CZ.productcode=="K_IU001353" ? "TSD000679" : …</code> → 재질 변수의 상품 속성(<code>#CZ.productcode</code>)으로 상품코드를 고르는 수식</li>
    <li><b>중간 변수</b> · <b>보고 변수</b>(가져오기·추가) · 아래 ‘숨김 변수 위치 표시’ 스위치</li>
    <li>상단 ‘여기서 변수 위치 검색’ 으로 변수를 찾아 이동</li>
  </ul>
  <p>요소 라이브러리·부품 라이브러리 탭의 도구 종류별 구성은 <a href="kujiale-brandgoods-analysis.html#cr-param">분석 문서 3-2절</a>에 정리했습니다.</p>
</section>

<section id="elements">
  <h2><span class="no">5</span>요소 · 보조 구조 속성 <span class="pill good">데이터</span></h2>
  <p class="lead">주방·욕실(cabinet) 정의 {n_el}종. 오른쪽 패널은 이 정의를 ‘패널 묶음’ 순서로 보여 줍니다(크기 → 물리 → 부품(기본) → 프론트 사용). 화면 예: 판재·외곽 틀·윤곽 제한.</p>
  {fig('04-props.jpg', '속성 패널 — 평면 판재 · 사각 외곽 틀 · 윤곽 제한 (값은 수식: #H, #W, #CZ, #CZFX, #PTFS …)')}
  {element_tables(prim)}
  <p class="note"><b>참고</b>‘사각 외곽 틀(模型外框)’은 크기 X·Y·Z, 위치 X·Y·Z, 호출 방식만 있습니다(화면). 전체 가구는 ‘모서리 기둥 안쪽 흡착선’, 창호는 흡착 윤곽·창 개구부와 모서리 기둥·면 흡착선 5종이 더 있고 윤곽 제한·내부 공간·배선이 없습니다.</p>
</section>

<section id="dialogs">
  <h2><span class="no">6</span>2D 윤곽 편집 <span class="pill info">화면</span></h2>
  {fig('05-profile-editor.jpg', '‘윤곽 편집’ — 판재 윤곽점(점1~4: -#W/2, ±#D/2 …)')}
  <ul>
    <li>위: 실행 취소 · 다시 실행 · <b>나가기</b>(저장 안 했으면 ‘아직 저장하지 않았습니다. 편집을 끝낼까요?’ 확인) · <b>저장</b></li>
    <li>가운데: 자 눈금 2D 캔버스, 번호 붙은 꼭짓점, 확대·축소·맞춤</li>
    <li>오른쪽: 작은 3D 미리보기 · 도구(선택 · <b>구멍</b> · <b>홈</b> 추가) · ‘사용자 정의 형상’ 선택(형상 템플릿 — ‘그리거나 도형 붙여넣기’) · 가로축/세로축 · 꼭짓점 목록(점마다 X·Y 수식 + 꼭짓점 종류) · 꼭짓점 추가 · 오프셋</li>
  </ul>
  <p class="note gap"><b>미확인</b>꼭짓점 종류(호·직선) 설정 창, 구멍·홈 추가 후 속성, 형상 템플릿 목록은 모델을 바꿔야 보이므로 확인하지 않았습니다.</p>

  <h2 style="margin-top:40px"><span class="no">7</span>대화상자 · 패널 <span class="pill info">화면</span></h2>
  <div class="tblwrap"><table class="spec">
    <tr><th>이름</th><th>내용</th></tr>
    <tr><td>업무 속성</td><td>모델의 생산·설계 규칙 선택 — 판재 세로/가로 절단, 프레임판 칸막이 단계, 판재 편집 사용, 칸막이 뒷판, 칸막이 프레임판, 상품 비고, 추가 주문(사용자 수식), 판면 방향 … (정의 55개는 8절)</td></tr>
    <tr><td>견적 출력 설정 (Alt+B)</td><td>모델 폭 · 모델 깊이 · 모델 높이 (견적에 쓸 크기 수식) · 취소/확인</td></tr>
    <tr><td>데이터 출력 설정 (Alt+S)</td><td>‘데이터 인터페이스 출력 파일(JSON·API) 다운로드용’ — 표: 변수 · 참조명 · 출력 참조명 · 출력 조건 · 출력 값(백엔드 설정 / 현재값). 시스템·사용자 변수 행</td></tr>
    <tr><td>부품 노드 보고 설정</td><td>‘하위 노드 기준으로 하위 모델의 변수를 위로 보고, 하위 모델을 교체해도 보고 규칙 유지’ — 부품 노드 · 보고 · 최상위 모델로 보고 · 보고 이름 접두어</td></tr>
    <tr><td>환경 조건</td><td>‘설계 툴에 끌어 놓을 때 변수를 환경 조건으로 정함 — <code>#selfPosition.x/y/z</code> · <code>#selfRotate.x/y/z</code>’ · 환경 조건 수식</td></tr>
    <tr><td>변수 계열</td><td>떠 있는 패널 — ‘변수 계열 없음 · 변수 계열 가져오기’</td></tr>
    <tr><td>모델 진단</td><td>떠 있는 패널 — 성능 검사(등급 A·점수·다시 진단 · 하위/현재 단계 숨김→억제 전환 · 표: 모델 이름·성능 점수·노드 수·면 수·숨김 비율·구성 상세) · 간섭 검사</td></tr>
    <tr><td>모델 버전</td><td>‘입고 때 이력 버전으로 기록’ — 현재 버전 / 이력 버전 · 표: 버전 · 시각 · 수정자 · 설명</td></tr>
  </table></div>
  <div class="pair">{fig('06-biz-props.jpg', '업무 속성')}{fig('07-data-output.jpg', '데이터 출력 설정')}</div>
  <div class="pair">{fig('08-diagnosis.jpg', '모델 진단 — 성능 검사')}{fig('11-versions.jpg', '모델 버전')}</div>
</section>

<section id="biz">
  <h2><span class="no">8</span>업무 속성 정의 ({len(bp)}개) <span class="pill good">데이터</span></h2>
  <p class="lead">절단·칸막이·가공(구멍·홈·공구) 같은 생산 규칙과, 크랭크·링크·로커·슬라이더 같은 하드웨어 동작 정의(도어 열림 등)가 섞여 있습니다. 행에 마우스를 올리면 쿠지알러 설명 원문이 보입니다.</p>
  {biz_table(bp)}
</section>

<section id="fn">
  <h2><span class="no">9</span>수식 ({len(fns)}개) <span class="pill good">데이터</span></h2>
  <p class="lead">변수 <code>#W</code>, 부품 참조 <code>@참조명.W</code>, 재질·스타일 변수의 상품 속성 <code>#CZ.productcode</code>(화면), 환경 <code>#selfPosition.x</code>(화면)를 씁니다.</p>
  {fn_table(fns)}
</section>

<section id="pages">
  <h2><span class="no">10</span>에디터 밖 관리 페이지 <span class="pill info">화면</span></h2>
  <div class="tblwrap"><table class="spec">
    <tr><th>페이지</th><th>내용</th></tr>
    <tr><td>전역 변수 콘솔<br><small>/vc/editor/globalvariable</small></td><td>메뉴 13개: 전역 변수 · 변수 템플릿 · 변수 계열 템플릿 · 로컬 변수 업그레이드 · 모델 일괄 수정(신·구) · 모델 검사 · 일괄 성능 진단 · 변수 등급 라벨 · 가상 하드웨어 모델 일괄 관리 · 사용자 출력 속성 템플릿 · 사용자 내용 수정 · 모델 업데이트(의존 그래프). 전역 변수 표: 번호 · 이름 · 참조명 · 변수 유형(스타일/재질) · 값 유형(선택형) · 현재값 · 기타 · 라벨 · 출력 참조명 · 그룹 · 편집/삭제 — <b>HANSSEM 45개</b>(예: EO/ML3 도어 <code>EM_DR</code>, KB 부엌도어 <code>KB_DR</code>, 찬넬 컬러 <code>EN_CHCZ</code>, 걸레받이 <code>KB_PLCZ</code>)</td></tr>
    <tr><td>파라메트릭 모델링 설정<br><small>/vc/editor/global/config</small></td><td>일반: 모델 자동 업데이트(예/아니오/매번 묻기) · 공간 모델링: 주방·욕실 / 전체 가구 프리셋 — 기본 모델(뒷판 · 도어 · 서랍 · 측판 · 이동 선반 · 고정 선반 · 바닥판 · 천판 · 세로 칸막이) · 이형 판재(모서리 따기 4방향 · 오각 4방향: 윤곽 변수·판재 지정·사용)</td></tr>
  </table></div>
  <div class="pair">{fig('09-global-vars.jpg', '전역 변수 콘솔')}{fig('10-settings.jpg', '파라메트릭 모델링 설정 — 공간 모델링 프리셋')}</div>
</section>

<section id="data">
  <h2><span class="no">11</span>모델 데이터 구조 (editorData) <span class="pill good">데이터</span></h2>
  <p class="lead">요소·하위 모델은 모두 <code>modelInstances</code> 에 <code>functionName</code>(예: <code>PrimitiveModel.plank</code>, <code>17122450.paramModel_52862349</code>, <code>17122450.furnitureModel_47114084</code>) + <code>parameters[{{paramName, value}}]</code>(값은 수식 문자열) 로 저장됩니다. 메시 상품은 <code>FurnitureModel.furnitureWithMaterial</code>(크기 <code>targetSize = #W·#D·#H</code>, 재질 부위 교체 <code>paramMeshInstance</code>)로 감쌉니다. 모델이 쓰는 하위 모델·재질 텍스처(타일 이미지)는 <code>resource</code> 에 함께 옵니다.</p>
  {keys_table(ed)}
</section>

<section id="hanssem">
  <h2><span class="no">12</span>한샘 모델 실태 (표본) <span class="pill good">데이터</span></h2>
  <div class="tblwrap"><table class="spec">
    <tr><th>모델</th><th>라이브러리</th><th>구성</th></tr>
    <tr><td>18T 오픈장 선반(D150) · 2단 지그재그 측판 · 지그재그 일반 배판 · 포켓 보강철물</td><td>반제품</td><td>평면 판재로 구성</td></tr>
    <tr><td>(L형)EURO5 딥네이처 1210 하부장 SET</td><td>제품(캐비닛 모드)</td><td>몸통 = 메시 래퍼(늘림) + 서랍(파라메트릭) + 세면기(메시 + 파라메트릭)</td></tr>
    <tr><td>Euro300 도어 계열</td><td>내부 부품</td><td>하위 파라메트릭 75~92개 + 메시 38~49개 조립</td></tr>
    <tr><td>싱크볼 · 빌트인 가전 · 댐핑 슬라이딩장</td><td>내부 부품 · 반제품</td><td>메시 래퍼(furnitureWithMaterial)</td></tr>
  </table></div>
  <p class="note"><b>뜻</b>쿠지알러도 메시 부품은 크기만 늘립니다. 늘릴 때 모양이 깨지지 않게 하는 수단이 ‘3D 모델 분할(模型切割)’이므로, 새 에디터·실행기는 판재 요소와 함께 <b>메시 래퍼 + 분할 영역</b>을 지원해야 한샘 모델을 그대로 표현할 수 있습니다.</p>
</section>

<section id="plan">
  <h2><span class="no">13</span>새 에디터 구현 범위 · 순서</h2>
  <ol>
    <li><b>데이터 형식</b> — editorData 구조를 그대로 씀(변수 · 모델 자신 · 부품 인스턴스 · 보조 구조 · 업무 속성 · 출력 설정 · resource). 요소 정의(5절)를 데이터로 넣어 속성 패널을 정의에서 자동 생성 → 쿠지알러 모델을 그대로 열 수 있음</li>
    <li><b>계산 엔진</b> — 수식 46종 + 재질·스타일 상품 속성(<code>#CZ.productcode</code>, getProductCustomAttr) · 전역 변수 · 하위 모델 인스턴스 · 메시 래퍼 · 요소 6종 형상 · 보조 구조. 웹 설계 화면과 공용 모듈, Unity 는 같은 예제 결과로 포팅 검증</li>
    <li><b>화면</b> — 1·2절 배치·메뉴·단축키, 왼쪽 3탭, 3D(2D 6방향·표시 모드 4종·분해), 구조 탐색, 속성 패널, 2D 윤곽 편집기</li>
    <li><b>파일·입고</b> — 모델 유형 선택(새로 만들기/열기) · 저장 · 저장 후 입고(이력 버전) · 다른 이름 · 모델 버전 · 컨텐츠 라이브러리 연결</li>
    <li><b>대화상자</b> — 업무 속성 · 견적 출력 · 데이터 출력 · 부품 노드 보고 · 환경 조건 · 변수 계열 · 모델 진단</li>
    <li><b>관리 페이지</b> — 전역 변수(스타일·재질 선택형) · 모델링 설정(자동 업데이트·공간 모델링 프리셋)</li>
  </ol>
  <p class="note gap"><b>미확인 — 화면을 더 봐야 하는 것</b>극속 모델링 · 문 개구부 연결 · 숨김→억제 하위 메뉴 · 부품 동명 변수 참조 · 플러그인 · 융합 요소 · 2D 윤곽 편집의 꼭짓점 종류·구멍·홈·형상 템플릿 · 변수 상세 편집 창(유형·범위·선택지) · 사용자 변수 그룹 관리 · 공간 모델링 동작 · 모델 교체 시 상속 속성 · 수정 가능 변수 선택 창 · 3D 모델 분할 결과 형식. 모두 모델을 바꾸는 조작이 필요해 이번에는 열지 않았습니다.</p>
</section>
'''
    toc = '''<nav class="toc"><div class="brand"><b>파라메트릭 에디터 명세</b><span>쿠지알러 参数化模型编辑器 → HP3 새 에디터</span></div>
  <a class="h1" href="#layout">1. 화면 구성</a><a class="h1" href="#menus">2. 메뉴 · 단축키</a><a class="h1" href="#model-props">3. 모델 속성</a>
  <a class="h1" href="#params">4. 파라미터 설정</a><a class="h1" href="#elements">5. 요소 · 보조 구조 속성</a><a class="h1" href="#dialogs">6. 2D 윤곽 편집</a>
  <a class="h2" href="#dialogs">7. 대화상자 · 패널</a><a class="h1" href="#biz">8. 업무 속성 정의</a><a class="h1" href="#fn">9. 수식</a>
  <a class="h1" href="#pages">10. 관리 페이지</a><a class="h1" href="#data">11. 모델 데이터 구조</a><a class="h1" href="#hanssem">12. 한샘 모델 실태</a><a class="h1" href="#plan">13. 구현 범위 · 순서</a></nav>'''
    doc = (f'<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           f'<title>파라메트릭 에디터 명세</title>\n<style>{STYLE}</style>\n</head>\n<body>\n<div class="layout">\n{toc}\n<main>{body}\n'
           '<footer>쿠지알러 HANSSEM 기업 계정을 2026-10-06 읽기 전용으로 조사해 작성 · <code>python scripts/build-editor-spec.py &lt;덤프 폴더&gt;</code> 로 다시 만듭니다. 사내 상품 정보가 들어 있으므로 외부 공유에 주의하세요.</footer>\n'
           '</main>\n</div>\n</body>\n</html>\n')
    OUT.write_text(doc, encoding='utf-8')
    print(f'{OUT} ({OUT.stat().st_size // 1024} KB), 캡처 {len(list(CAP.glob("*.jpg")))}개')


if __name__ == '__main__':
    main()

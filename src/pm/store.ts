import type { ToolType } from './modelTypes';
import { basicVars, defaultFrame, defaultModelProps, uid } from './resolve';
import type { PmModel, PmVar, VarTemplateFolder } from './types';

/**
 * 새 에디터 저장소 (브라우저 localStorage) — 기존 에디터(hp3-param-models)와 따로 둔다.
 *  hp3-pm-models        파라메트릭 모델
 *  hp3-pm-globals       전역 변수 (변수와 데이터 › 전역 변수)
 *  hp3-pm-var-templates 변수 템플릿 폴더
 */
const MODELS = 'hp3-pm-models';
const GLOBALS = 'hp3-pm-globals';
const TEMPLATES = 'hp3-pm-var-templates';

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  localStorage.setItem(key, JSON.stringify(v));
}

export const loadModels = (): PmModel[] => read<PmModel[]>(MODELS, []);
export const loadModel = (id: string) => loadModels().find((m) => m.id === id);
export function saveModel(m: PmModel): PmModel {
  const list = loadModels();
  const next = { ...m, updatedAt: Date.now() };
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = next; else list.unshift(next);
  write(MODELS, list);
  return next;
}
export function deleteModel(id: string) {
  write(MODELS, loadModels().filter((m) => m.id !== id));
}

export const loadGlobals = (): PmVar[] => read<PmVar[]>(GLOBALS, []);
export const saveGlobals = (list: PmVar[]) => write(GLOBALS, list);

export const loadTemplates = (): VarTemplateFolder[] => read<VarTemplateFolder[]>(TEMPLATES, [{ id: 'tpl-default', name: '기본 폴더', vars: [] }]);
export const saveTemplates = (list: VarTemplateFolder[]) => write(TEMPLATES, list);

/** 새 모델 — 모델 유형 선택(选择模型类别) 결과로 시작. 기본 변수 W·D·H·CZ + 외곽 틀만 있는 빈 모델 */
export function newModel(init: { tooltype: ToolType; lib?: number; library: string; categoryId?: number; category: string; name?: string }): PmModel {
  const now = Date.now();
  return {
    id: uid('PM'),
    name: init.name ?? '새 파라메트릭 모델',
    tooltype: init.tooltype,
    lib: init.lib,
    library: init.library,
    categoryId: init.categoryId,
    category: init.category,
    vars: basicVars(),
    groups: [],
    frame: defaultFrame(),
    nodes: [],
    props: defaultModelProps(),
    biz: {},
    quote: { x: '#W', y: '#D', z: '#H' },
    output: [],
    nodeReports: [],
    version: 0,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 모델 버전 기록 — ‘저장 후 입고’ 때 이력 버전으로 (모델 버전 창: 버전 · 시각 · 수정자 · 설명) */
export function withVersion(m: PmModel, by: string, desc: string): PmModel {
  const version = m.version + 1;
  // 이미지는 스냅샷에서 뺀다 (localStorage 용량)
  const { versions, preview: _p, markImage: _k, ...rest } = m;
  void _p; void _k;
  const snapshot = JSON.stringify({ ...rest, version });
  return { ...m, version, versions: [{ version, at: Date.now(), by, desc, snapshot }, ...versions].slice(0, 30) };
}

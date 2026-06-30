/** 사용자 관리의 브랜드/그룹 — 컨텐츠 권한 등 다른 페이지와 공유되는 조직 데이터 */
export type Brand = { id: string; name: string };
export type Group = { id: string; name: string; brandId: string };

export const INITIAL_BRANDS: Brand[] = [
  { id: 'b-hanssem', name: '한샘' },
  { id: 'b-partner', name: '파트너사' },
];

export const INITIAL_GROUPS: Group[] = [
  { id: 'g-ops', name: '운영팀', brandId: 'b-hanssem' },
  { id: 'g-beta', name: '베타 테스터', brandId: 'b-hanssem' },
  { id: 'g-vip', name: 'VIP 고객', brandId: 'b-hanssem' },
  { id: 'g-b2b', name: 'B2B 파트너', brandId: 'b-partner' },
];
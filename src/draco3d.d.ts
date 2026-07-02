/** draco3d npm 패키지 타입 선언 — 패키지가 .d.ts 를 제공하지 않아 최소 선언. */
declare module 'draco3d' {
  /** Emscripten 모듈 설정 — locateFile 로 .wasm 경로를 지정해 브라우저에서 사용. */
  interface DracoModuleConfig {
    locateFile?: (file: string, prefix: string) => string;
  }
  /** gltf-transform 이 'draco3d.encoder'/'draco3d.decoder' 의존성으로 받는 모듈 객체. */
  type DracoModule = object;
  const draco3d: {
    createEncoderModule(config?: DracoModuleConfig): Promise<DracoModule>;
    createDecoderModule(config?: DracoModuleConfig): Promise<DracoModule>;
  };
  export default draco3d;
}

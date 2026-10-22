export const SYSTEM_PROMPT = `당신은 대한민국 건축구조기술사 수준의 구조 설계 법규 검토자입니다. 사용자가 올린 구조 설계 도면(구조평면도, 일람표, 단면·상세도, 구조계산서 요약 등)을 읽고, 현행 법령과 국가건설기준에 비추어 위법 소지나 기준 미달 사항이 있는지 검토합니다.

검토 범위 (해당되는 것만):
- 건축법, 건축법 시행령, 건축법 시행규칙 — 구조 안전 확인, 구조내력, 내진능력 공개, 관계전문기술자 협력 대상 등
- 건축물의 구조기준 등에 관한 규칙
- 국가건설기준 KDS 41 (건축구조기준) — 하중, 철근콘크리트·강구조·조적·목구조 설계, 내진설계 등
- 건축물의 피난·방화구조 등의 기준에 관한 규칙 — 내화구조 요건 중 구조 부재와 관련된 부분
- 지진·화산재해대책법 등 내진설계 의무 관련 규정
- 필요하면 해당 지역 조례

검토 원칙:
- 법령은 자주 개정됩니다. 기억에 의존하지 말고 web_search / web_fetch 로 국가법령정보센터(law.go.kr)와 국가건설기준센터(kcsc.re.kr)에서 현행 조문·기준을 확인한 뒤 근거로 인용하세요. 확인하지 못한 조문 번호는 지어내지 말고, 확인되지 않았다고 밝히세요.
- 도면에서 읽은 값(부재 치수, 철근 배근, 콘크리트·강재 강도, 층수, 높이, 연면적, 경간, 용도, 지역 등)과 법·기준이 요구하는 값을 나란히 비교하세요. 도면에서 읽은 값은 어느 도면·위치에서 읽었는지 적으세요.
- 도면만으로 판단할 수 없는 항목(구조계산서가 필요한 응력 검토 등)은 "확인 필요"로 두고 무엇이 더 필요한지 적으세요. 확실하지 않은 것을 "적합"으로 처리하지 마세요.
- 도면 판독이 불확실한 값(해상도, 잘린 부분 등)은 그 사실을 명시하세요.
- 결과는 실무자가 바로 보완 작업에 쓸 수 있도록 구체적으로, 한국어로 작성하세요.
- 이 검토는 참고용 사전 검토이며, 최종 판단은 건축구조기술사와 허가권자에게 있다는 점을 summary 끝에 한 문장으로 밝히세요.`;

const VERDICTS = ["적합", "부적합 의심", "확인 필요", "해당 없음"];

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "overall", "project_facts", "checks", "missing_info", "references"],
  properties: {
    summary: { type: "string", description: "검토 결과 요약 (3~6문장)" },
    overall: {
      type: "string",
      enum: ["적합", "부적합 의심", "확인 필요"],
      description: "전체 판정: 부적합 의심 항목이 하나라도 있으면 '부적합 의심'",
    },
    project_facts: {
      type: "array",
      description: "도면에서 읽어 낸 건축물 개요",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "value", "source"],
        properties: {
          item: { type: "string" },
          value: { type: "string" },
          source: { type: "string", description: "읽은 도면·위치, 또는 '사용자 입력'" },
        },
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "item", "legal_basis", "requirement", "design_value", "verdict", "comment"],
        properties: {
          category: { type: "string", description: "예: 구조안전 확인, 내진설계, 하중, RC 부재, 강구조, 내화" },
          item: { type: "string" },
          legal_basis: { type: "string", description: "법령명과 조항 또는 KDS 코드·항목" },
          requirement: { type: "string", description: "법·기준이 요구하는 내용" },
          design_value: { type: "string", description: "도면상의 값" },
          verdict: { type: "string", enum: VERDICTS },
          comment: { type: "string", description: "판정 이유와 보완 방법" },
        },
      },
    },
    missing_info: {
      type: "array",
      description: "판단에 필요하지만 도면에 없는 자료",
      items: { type: "string" },
    },
    references: {
      type: "array",
      description: "실제로 확인한 법령·기준 출처",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string" } },
      },
    },
  },
};

const PROJECT_FIELDS = {
  location: "대지 위치",
  use: "건축물 용도",
  structure: "구조 형식",
  floors: "층수 (지상/지하)",
  height: "높이",
  area: "연면적",
  notes: "추가 요청사항",
};

export function buildUserText(project) {
  const lines = Object.entries(PROJECT_FIELDS)
    .filter(([key]) => project[key]?.trim())
    .map(([key, label]) => `- ${label}: ${project[key].trim()}`);
  const today = new Date().toISOString().slice(0, 10);
  return [
    `첨부한 구조 설계 도면을 ${today} 기준 현행 법령과 기준으로 검토해 주세요.`,
    lines.length ? `\n사용자가 입력한 건축물 정보:\n${lines.join("\n")}` : "\n건축물 정보는 도면에서 읽어 주세요.",
  ].join("\n");
}

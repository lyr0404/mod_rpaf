# 구조설계 법규 검토기

구조 설계 도면(PDF·이미지)을 올리면 Claude가 도면을 읽고, 국가법령정보센터(law.go.kr)와
국가건설기준센터(kcsc.re.kr)에서 **현행** 법령·기준을 직접 검색해 위법 소지나 기준 미달 사항을 표로 정리해 주는 웹 페이지입니다.

검토 대상: 건축법·시행령·시행규칙, 건축물의 구조기준 등에 관한 규칙, KDS 41(건축구조기준, 내진설계 포함),
피난·방화구조 규칙 중 구조 부재 관련 부분, 필요 시 지역 조례.

> 결과는 **참고용 사전 검토**입니다. 최종 판단은 건축구조기술사와 허가권자에게 있습니다.

## 도커로 서버에 띄우기 (park.trzoa.com) — 추천

healthdev.trzoa.com과 같은 방식입니다. 서버에 도커와 도커 컴포즈가 설치되어 있어야 합니다.

**1. 서버에 올리고 설정하기**

이 `compliance-checker` 폴더를 서버에 복사한 뒤, 그 폴더에서:

```bash
cp .env.example .env
nano .env        # API 키와 접속 비밀번호를 입력하고 저장
```

**2. 실행하기**

```bash
docker compose up -d --build
```

서버의 3000번 포트에서 실행됩니다. healthdev가 이미 3000번을 쓰고 있다면
`docker-compose.yml`의 `"3000:3000"`을 `"3001:3000"`처럼 앞쪽 숫자만 바꾸세요.
서버를 재부팅해도 자동으로 다시 켜집니다.

**3. 도메인 연결하기** — healthdev를 연결한 방식 그대로 하면 됩니다.

- **Cloudflare 터널(Zero Trust → Tunnels)을 쓰는 경우**: healthdev가 있는 터널에
  공개 호스트 이름(Public Hostname)을 하나 추가합니다. 하위 도메인 `park`, 도메인 `trzoa.com`,
  서비스 `http://localhost:3000`으로 입력합니다.
- **Cloudflare DNS + Nginx를 쓰는 경우**: Cloudflare DNS에 healthdev와 똑같이 `park` 레코드를 추가합니다
  (같은 서버 IP, 주황색 구름 켜기). 그다음 Nginx에 아래 설정을 추가하고 `sudo nginx -s reload`를 실행합니다.

```nginx
server {
    listen 80;
    server_name park.trzoa.com;
    client_max_body_size 50m;          # 도면 업로드 용량
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_buffering off;           # 진행 상황 실시간 표시
        proxy_read_timeout 900s;       # 검토가 몇 분 걸리므로
    }
}
```

**자주 쓰는 명령**

| 하고 싶은 일 | 명령 |
|---|---|
| 코드 수정 후 다시 띄우기 | `docker compose up -d --build` |
| 로그 보기 | `docker compose logs -f` |
| 끄기 | `docker compose down` |

## Cloudflare Workers에 배포하기 (도커 대신 쓸 수 있는 방법)

Cloudflare Workers에 올리면 `park.trzoa.com` 연결과 HTTPS 인증서까지 Cloudflare가 자동으로 처리합니다.

**준비물**
- `trzoa.com` 도메인이 Cloudflare 계정에 등록되어 있어야 합니다 (네임서버가 Cloudflare로 지정된 상태).
- Cloudflare DNS에 `park` 레코드가 이미 있으면 먼저 지우세요. 배포할 때 Cloudflare가 자동으로 만듭니다.
- **Workers 유료 요금제(Workers Paid, 월 $5)를 권장합니다.** 무료 요금제는 요청당 CPU 시간이 10ms라서 큰 도면 파일을 처리하다 끊길 수 있습니다.

**배포 순서** (PC에서 한 번만)

```bash
cd compliance-checker
npm install
npx wrangler login                              # 브라우저에서 Cloudflare 로그인
npx wrangler secret put ANTHROPIC_API_KEY       # API 키 입력
npx wrangler secret put ACCESS_PASSWORD         # 접속 비밀번호 입력 (권장)
npm run deploy
```

몇 분 뒤 https://park.trzoa.com 에 접속하면 됩니다. 비밀번호를 설정했다면 브라우저가 로그인 창을 띄웁니다. 아이디는 아무거나 입력하고 비밀번호만 맞으면 됩니다.
코드를 고친 뒤에는 `npm run deploy`만 다시 실행하면 됩니다.

다른 도메인을 쓰려면 `wrangler.jsonc`의 `routes` 항목을 고치세요.

## 내 PC나 서버에서 실행하기

Node.js 20 이상과 Anthropic API 키가 필요합니다.

```bash
cd compliance-checker
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# http://localhost:3000 접속
```

## 설정값

Cloudflare에서는 `wrangler secret put 이름`으로, 내 PC에서는 환경 변수로 지정합니다.

| 이름 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (필수) | Anthropic API 키 |
| `ACCESS_PASSWORD` | (없음) | 지정하면 접속할 때 비밀번호를 묻습니다 |
| `CLAUDE_MODEL` | `claude-opus-5-5` | 사용할 모델 |
| `CLAUDE_EFFORT` | `high` | 검토 깊이 (`low`·`medium`·`high`·`xhigh`·`max`) |
| `PORT` | `3000` | 서버 포트 (내 PC 실행 시에만) |

## 사용법

1. 도면 파일을 올립니다 (PDF, PNG, JPG, WEBP, GIF — 합계 30MB 이하). DWG는 PDF로 내보내서 올려 주세요.
2. 대지 위치·용도·구조 형식·층수 등 아는 정보를 입력합니다 (비워 두면 도면에서 읽습니다).
3. **검토 시작**을 누르면 법령 검색 과정이 실시간으로 표시되고, 몇 분 뒤 결과 표가 나옵니다.
4. 판정(부적합 의심 / 확인 필요 / 적합 / 해당 없음)별로 걸러 보거나 **인쇄 / PDF 저장**으로 보관합니다.

## 구조

- `review.js` — 검토 로직. 업로드된 도면을 Claude에 보내고, 법령 사이트로 제한된 웹 검색·조회 도구를 붙여 진행 상황과 결과를 내보냅니다.
- `worker.js` + `wrangler.jsonc` — Cloudflare Workers 진입점과 설정 (도메인 연결 포함).
- `server.js` — 내 PC나 서버에서 실행할 때 쓰는 Express 진입점.
- `Dockerfile` + `docker-compose.yml` + `.env.example` — 도커로 띄울 때 쓰는 설정.
- `prompt.js` — 검토 지침(시스템 프롬프트)과 결과 JSON 스키마.
- `public/index.html` — 업로드·진행 상황·결과 화면.

## 주의

- 비용: 1회 검토의 API 비용은 도면 크기와 검색 횟수에 따라 달라집니다.
- 인터넷에 공개할 때는 `ACCESS_PASSWORD`를 꼭 설정하세요. 설정하지 않으면 접속한 사람 누구나 서버의 API 키로 검토를 돌릴 수 있습니다.
- 도면 해상도가 낮으면 치수·배근을 잘못 읽을 수 있습니다. 결과의 "도면에서 읽은 건축물 개요"와 "도면 값"을 꼭 대조하세요.

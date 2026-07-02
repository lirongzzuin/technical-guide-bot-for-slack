import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wb = XLSX.readFile(path.join(ROOT, 'shoplinker_markets.xlsx'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['시트1'], { header: 1 });

// 복합 이름에서 주 키 추출: "SSG (이마트, 신세계닷컴)" → "SSG"
function toKey(name) {
  return name
    .replace(/\s*\([^)]*\)/g, '')
    .split('/')[0]
    .replace(/\s+/g, '')
    .trim();
}

// 복합 이름에서 별칭 추출:
//   "지그재그/포스티" → ["포스티"]
//   "신세계V(구 SI빌리지)" → ["SI빌리지"]   ← '구' 접두사 제거
//   "SSG (이마트, 신세계닷컴)" → ["이마트", "신세계닷컴"]
function toAliases(name) {
  const aliases = [];

  const bracketMatch = name.match(/\(([^)]+)\)/);
  if (bracketMatch) {
    bracketMatch[1].split(/[,，]/).forEach(part => {
      const cleaned = part.trim().replace(/^구\s+/, '').replace(/\s+/g, '');
      if (cleaned) aliases.push(cleaned);
    });
  }

  const slashParts = name.replace(/\s*\([^)]*\)/g, '').split('/');
  if (slashParts.length > 1) {
    aliases.push(...slashParts.slice(1).map(s => s.replace(/\s+/g, '').trim()));
  }

  return aliases.filter(Boolean);
}

// 항목명(짧음, 공백 거의 없음)과 안내 문구(긴 자연어)를 구분
function isNote(field) {
  return typeof field === 'string' && field.length > 20 && field.includes(' ');
}

function buildGuideText(displayName, fields, guideUrls, adminUrl, categoryCaveat) {
  const lines = [];

  // 헤더 — 채널에 노출되는 첫 줄
  lines.push(`*${displayName}* — 샵링커 연동 필요 정보`);
  lines.push('');

  const mainFields = fields.filter(f => !isNote(f));
  const notes = fields.filter(f => isNote(f));

  // 필요 계정 정보
  lines.push('*필요 계정 정보*');
  if (mainFields.length > 0) {
    mainFields.forEach(f => lines.push(`• ${f}`));
  } else {
    lines.push('_등록된 정보가 없습니다._');
  }
  if (notes.length > 0) {
    notes.forEach(n => lines.push(`> ${n}`));
  }

  // 빠른 링크
  const hasLinks = guideUrls.length > 0 || adminUrl;
  if (hasLinks) {
    lines.push('');
    lines.push('*빠른 링크*');
    guideUrls.forEach((url, i) => {
      const label = guideUrls.length > 1 ? `설정 가이드 ${i + 1} 보기` : '설정 가이드 보기';
      lines.push(`• <${url}|${label}>`);
    });
    if (adminUrl) {
      lines.push(`• <${adminUrl}|어드민 바로가기>`);
    }
  }

  // 비고 — 가이드/어드민 누락, 카테고리 특이사항
  const caveats = [];
  if (categoryCaveat) caveats.push(categoryCaveat);
  if (!adminUrl && !categoryCaveat) {
    caveats.push('어드민 URL이 등록되어 있지 않습니다. 제품팀에 문의해 주세요.');
  }
  if (guideUrls.length === 0) {
    caveats.push('별도 설정 가이드가 없습니다. 제품팀에 문의해 주세요.');
  }

  if (caveats.length > 0) {
    lines.push('');
    lines.push('*비고*');
    caveats.forEach(c => lines.push(`• ${c}`));
  }

  return lines.join('\n');
}

// 카테고리별 안내 문구
const CATEGORY_CAVEATS = {
  '어드민 확인 불가': '어드민 URL이 미확인된 판매처입니다. 별도 어드민 주소가 있는지 제품팀에 확인해 주세요.',
  '쇼핑몰 확인 불가': '쇼핑몰 운영 또는 어드민 접근이 미확인된 판매처입니다. 연동 가능 여부를 먼저 확인해 주세요.',
};

// 행 파싱
const guides = {};
const keyOrder = [];
const aliasMap = {};   // 통계용
let category = null;

for (const row of rows.slice(1)) {
  const name = row[0];
  if (!name) continue;

  // 섹션 헤더 행 감지 (판매처명만 있고 필요 정보가 없음)
  if (!row[1]) {
    category = String(name);
    continue;
  }

  const fields = row.slice(1, 9).filter(v => v != null && v !== '');
  const guideUrls = [row[9], row[10]]
    .filter(v => v != null && typeof v === 'string' && v.startsWith('http'));
  const adminUrl = (typeof row[11] === 'string' && row[11].startsWith('http')) ? row[11] : null;

  const categoryCaveat = CATEGORY_CAVEATS[category] || null;

  const key = toKey(name);
  const aliases = toAliases(name);
  const text = buildGuideText(name, fields, guideUrls, adminUrl, categoryCaveat);

  if (!guides[key]) {
    guides[key] = text;
    keyOrder.push(key);
  }
  aliases.forEach(alias => {
    if (!guides[alias]) {
      guides[alias] = text;
      aliasMap[alias] = key;
    }
  });
}

// help 텍스트
const sortedKeys = [...keyOrder].sort((a, b) => a.localeCompare(b, 'ko'));
const keyList = sortedKeys.join(' · ');
const aliasList = Object.entries(aliasMap)
  .map(([alias, target]) => `\`${alias}\`→\`${target}\``)
  .join(' · ');

const helpText = [
  '*판매처등록 가이드*',
  '샵링커에 새 판매처 연동 시 필요한 *계정 정보·설정 가이드·어드민 주소*.',
  '',
  '*사용법*',
  '• `/판매처등록 쿠팡` — 정확한 판매처명',
  '• `/판매처등록 롯데` — 부분 검색',
  '',
  `*지원 판매처 (${keyOrder.length}개)*`,
  keyList,
  aliasList ? `\n*별칭*\n${aliasList}` : '',
  '',
  '*건의*',
  '`/판매처등록 건의 <내용>`',
].filter(line => line !== '').join('\n');

guides['help'] = helpText;

// 파일 생성
const entries = Object.entries(guides)
  .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n');

const output = `// AUTO-GENERATED from shoplinker_markets.xlsx
// To update: npm run build-sellers

const seller = {
  description: '판매처별 샵링커 연동 필요 정보',
  guides: {
${entries}
  },
};

export default seller;
`;

const outPath = path.join(ROOT, 'guides', 'seller.js');
writeFileSync(outPath, output, 'utf8');

console.log(`생성 완료: ${outPath}`);
console.log(`판매처 수: ${keyOrder.length}개`);
console.log(`별칭 수: ${Object.keys(aliasMap).length}개 (${Object.keys(aliasMap).join(', ')})`);
console.log(`총 키 수: ${Object.keys(guides).length - 1}개`);

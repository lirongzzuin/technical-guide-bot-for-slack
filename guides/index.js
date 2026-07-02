import shoplinker from './shoplinker.js';
import allocation from './allocation.js';
import seller from './seller.js';
import inbound from './inbound.js';
import usage from './usage.js';
import errorSearch from './error-search.js';

// 새 명령어 추가: 이 맵에 { '명령어': module } 형태로 추가하면 됩니다.
// key는 Slack slash command 이름과 정확히 일치해야 합니다 (슬래시 제외).
const registry = {
  '샵링커': shoplinker,
  '할당': allocation,
  '판매처등록': seller,
  '입고요청서': inbound,
  '사용법': usage,
  '오류검색': errorSearch,
};

export default registry;

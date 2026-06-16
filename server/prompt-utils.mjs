export const AUTHORIZATION_STATEMENT =
  "授权声明：我确认已获得照片中所有可识别人物的明确授权。照片人物均为成年人。授权范围包括将其肖像作为面部与气质参考，用于本次 AI 图片生成、风格化写真、换装、场景重构和艺术化精修。生成内容不得用于冒充真实事件、虚假代言、欺骗传播、色情化、侮辱化、违法用途或损害本人名誉的场景。";

export function withAuthorizationStatement(prompt, enabled) {
  const trimmed = String(prompt || "").trim();
  if (!enabled || trimmed.startsWith(AUTHORIZATION_STATEMENT)) {
    return trimmed;
  }
  return `${AUTHORIZATION_STATEMENT}\n\n${trimmed}`;
}

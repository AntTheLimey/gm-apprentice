const { escapeHtml } = require('../../../processor');
const { block, num, asWritten } = require('../render');

function renderSkills(model) {
  const items = model.skills.map((s) => {
    const cls = `dnd5e-skill${s.proficient ? ' is-prof' : ''}${s.expert ? ' is-expert' : ''}`;
    const title = s.expert ? ' title="Expertise"' : s.proficient ? ' title="Proficient"' : '';
    return `<li class="${cls}"><span class="dnd5e-dot"${title}></span><span class="dnd5e-skill-name">${escapeHtml(s.name)}</span>`
      + `<span class="dnd5e-lbl">${escapeHtml(s.ability)}</span>${num(s.modifier)}</li>`;
  }).join('');
  const inner = (items ? `<ul class="dnd5e-skills">${items}</ul>` : '') + asWritten(model.asWritten.skills);
  return block('skills', 'Skills', inner);
}

module.exports = { renderSkills };

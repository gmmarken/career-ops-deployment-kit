# Demo GIF (vhs: brew install vhs). From the kit folder, copy the kit into an empty /tmp/job-search first:
#   rm -rf /tmp/job-search && mkdir /tmp/job-search && rsync -a --exclude .git --exclude node_modules ./ /tmp/job-search/career-ops-deployment-kit/
# then: vhs docs/img/demo.tape   (uses only made-up example data)
Output "docs/img/demo.gif"
Set Shell bash
Set FontSize 13
Set Width 1200
Set Height 1060
Set Padding 18
Set TypingSpeed 25ms
Set Theme "Catppuccin Mocha"
Hide
Type "export PS1='$ ' && cd /tmp/job-search && clear"
Enter
Show
Type "# 1. One command: pinned career-ops, a private folder from templates, then a setup check"
Enter
Type "career-ops-deployment-kit/install.sh"
Enter
Sleep 16s
Sleep 6s
Hide
Type "clear && cd career-ops-deployment-kit"
Enter
Show
Type "# 2. The model extracts facts; tested code decides the tier. A 'Forward Deployed' title that is really an engineering job:"
Enter
Type "node scripts/tier-facts.mjs examples/forward-deployed-engineer.facts.json --rules engine/tier-rules.example.json --today 2026-11-20"
Enter
Sleep 6s
Type "# A real deployment role, every rule shown with the quote behind it:"
Enter
Type "node scripts/tier-facts.mjs examples/deployment-strategist.facts.json --rules engine/tier-rules.example.json --today 2026-11-20"
Enter
Sleep 7s

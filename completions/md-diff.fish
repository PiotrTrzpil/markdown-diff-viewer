# Fish completion for md-diff
# Install: md-diff completions fish > ~/.config/fish/completions/md-diff.fish

complete -c md-diff -f

complete -c md-diff -s h -l help -d 'Show help'
complete -c md-diff -s v -l version -d 'Show version'
complete -c md-diff -s o -l out -r -d 'Write HTML to file'
complete -c md-diff -s t -l theme -x -a 'dark solar' -d 'Color theme'
complete -c md-diff -s q -l quiet -d 'Suppress non-essential output'
complete -c md-diff -s w -l watch -d 'Watch files and regenerate'
complete -c md-diff -s p -l preview -d 'Show diff in terminal'
complete -c md-diff -s j -l json -d 'Output as JSON'
complete -c md-diff -s c -l copy -d 'Copy HTML to clipboard'
complete -c md-diff -l no-open -d 'Do not auto-open in browser'
complete -c md-diff -l debug -d 'Enable debug output'
complete -c md-diff -l staged -d 'Compare staged changes to HEAD'
complete -c md-diff -l compare -x -a '(git branch -a 2>/dev/null | sed "s/^[* ]*//" | sed "s/remotes\///" )' -d 'Compare working dir to branch'
complete -c md-diff -l pr -x -d 'Compare markdown files in a PR'
complete -c md-diff -l git -x -a '(git for-each-ref --format="%(refname:short)" 2>/dev/null; echo HEAD; echo HEAD~1; echo HEAD~2; echo HEAD~3)' -d 'Compare between git refs'

function __md_diff_git_shortcuts
    echo '@~1'
    echo '@~2'
    echo '@~3'
    echo '@~4'
    echo '@~5'
    for branch in (git branch 2>/dev/null | sed 's/^[* ]*//')
        echo "@$branch"
    end
    for branch in (git branch -r 2>/dev/null | sed 's/^[* ]*//' | grep -v HEAD)
        echo "@$branch"
    end
end

function __md-diff_fuzzy_files
    if command -q fd
        fd --type f --extension md 2>/dev/null
    else if git rev-parse --is-inside-work-tree &>/dev/null
        git ls-files '*.md' 2>/dev/null
    else
        find . -maxdepth 3 -name '*.md' 2>/dev/null | sed 's|^\./||'
    end
end

complete -c md-diff -n 'not string match -q -- "-*" (commandline -ct)' -a '(__md_diff_git_shortcuts)' -d 'Git shortcut'
complete -c md-diff -n 'not string match -q -- "@*" (commandline -ct); and not string match -q -- "-*" (commandline -ct)' -a '(__md-diff_fuzzy_files)' -d 'Markdown file'


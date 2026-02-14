/**
 * Shell completion scripts embedded for CLI output.
 * Usage: md-diff --completions bash|zsh|fish
 */

export const BASH_COMPLETION = `#!/bin/bash
# Bash completion for md-diff
# Install: eval "$(md-diff --completions bash)" in ~/.bashrc

_md_diff_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    opts="--help --version --out --theme --quiet --watch --preview --json --copy --no-open --debug --git --compare --staged --pr"

    case "$prev" in
        --theme|-t)
            COMPREPLY=($(compgen -W "dark solar" -- "$cur"))
            return 0
            ;;
        --out|-o)
            COMPREPLY=($(compgen -f -- "$cur"))
            return 0
            ;;
        --compare)
            local branches=$(git branch -a 2>/dev/null | sed 's/^[* ]*//' | sed 's/remotes\\///')
            COMPREPLY=($(compgen -W "$branches" -- "$cur"))
            return 0
            ;;
        --pr)
            return 0
            ;;
        --git)
            local refs=$(git for-each-ref --format='%(refname:short)' 2>/dev/null)
            refs="$refs HEAD HEAD~1 HEAD~2 HEAD~3"
            COMPREPLY=($(compgen -W "$refs" -- "$cur"))
            return 0
            ;;
    esac

    if [[ "$cur" == @* ]]; then
        local completions="@~1 @~2 @~3 @~4 @~5"
        local branches=$(git branch 2>/dev/null | sed 's/^[* ]*//')
        for branch in $branches; do
            completions="$completions @$branch"
        done
        local remote_branches=$(git branch -r 2>/dev/null | sed 's/^[* ]*//' | grep -v HEAD)
        for branch in $remote_branches; do
            completions="$completions @$branch"
        done
        COMPREPLY=($(compgen -W "$completions" -- "$cur"))
        return 0
    fi

    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "$opts" -- "$cur"))
        return 0
    fi

    # Fuzzy file completion using fd (respects .gitignore)
    if command -v fd &>/dev/null; then
        local files=$(fd --type f --extension md 2>/dev/null)
        if [[ -n "$cur" ]]; then
            local pattern="\${cur//[^a-zA-Z0-9_.\\/-]/}"
            files=$(echo "$files" | grep -i "$pattern" 2>/dev/null)
        fi
        COMPREPLY=($(compgen -W "$files" -- ""))
        return 0
    fi

    # Fallback: git ls-files (respects .gitignore)
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local files=$(git ls-files '*.md' 2>/dev/null)
        if [[ -n "$cur" ]]; then
            local pattern="\${cur//[^a-zA-Z0-9_.\\/-]/}"
            files=$(echo "$files" | grep -i "$pattern" 2>/dev/null)
        fi
        COMPREPLY=($(compgen -W "$files" -- ""))
        return 0
    fi

    COMPREPLY=($(compgen -f -X '!*.md' -- "$cur"))
    COMPREPLY+=($(compgen -d -- "$cur"))
}

complete -F _md_diff_completions md-diff
`;

export const ZSH_COMPLETION = `#compdef md-diff
# Zsh completion for md-diff
# Install: md-diff --completions zsh > ~/.zsh/completions/_md-diff

_md-diff_git_refs() {
    local refs
    refs=(
        '@~1:Previous commit'
        '@~2:2 commits ago'
        '@~3:3 commits ago'
        '@~4:4 commits ago'
        '@~5:5 commits ago'
    )
    local branches
    branches=(\${(f)"$(git branch 2>/dev/null | sed 's/^[* ]*//')"})
    for branch in $branches; do
        refs+=("@$branch:Branch $branch")
    done
    local remote_branches
    remote_branches=(\${(f)"$(git branch -r 2>/dev/null | sed 's/^[* ]*//' | grep -v HEAD)"})
    for branch in $remote_branches; do
        refs+=("@$branch:Remote $branch")
    done
    _describe -t git-refs 'git reference' refs
}

_md-diff_branches() {
    local branches
    branches=(\${(f)"$(git branch -a 2>/dev/null | sed 's/^[* ]*//' | sed 's/remotes\\///')"})
    _describe -t branches 'branch' branches
}

_md-diff_fuzzy_files() {
    local files pattern
    pattern="\${words[CURRENT]}"

    if (( $+commands[fd] )); then
        files=(\${(f)"$(fd --type f --extension md 2>/dev/null)"})
        if [[ -n "$pattern" ]]; then
            files=(\${(M)files:#*\${~pattern}*})
        fi
        _describe -t md-files 'markdown file' files
        return
    fi

    if git rev-parse --is-inside-work-tree &>/dev/null; then
        files=(\${(f)"$(git ls-files '*.md' 2>/dev/null)"})
        if [[ -n "$pattern" ]]; then
            files=(\${(M)files:#*\${~pattern}*})
        fi
        _describe -t md-files 'markdown file' files
        return
    fi

    _files -g '*.md'
}

_md-diff() {
    local context state state_descr line
    typeset -A opt_args

    _arguments -C \\
        '(-h --help)'{-h,--help}'[Show help]' \\
        '(-v --version)'{-v,--version}'[Show version]' \\
        '(-o --out)'{-o,--out}'[Write HTML to file]:output file:_files' \\
        '(-t --theme)'{-t,--theme}'[Color theme]:theme:(dark solar)' \\
        '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]' \\
        '(-w --watch)'{-w,--watch}'[Watch files and regenerate on changes]' \\
        '(-p --preview)'{-p,--preview}'[Show diff in terminal]' \\
        '(-j --json)'{-j,--json}'[Output as JSON]' \\
        '(-c --copy)'{-c,--copy}'[Copy HTML to clipboard]' \\
        '--no-open[Do not auto-open in browser]' \\
        '--debug[Enable debug output]' \\
        '--git[Compare between git refs]:ref1:->gitref:ref2:->gitref' \\
        '--compare[Compare working dir to branch]:branch:_md-diff_branches' \\
        '--staged[Compare staged changes to HEAD]' \\
        '--pr[Compare markdown files in a PR]:PR number:' \\
        '*:file:->files'

    case "$state" in
        files)
            if [[ "\${words[CURRENT]}" == @* ]]; then
                _md-diff_git_refs
            else
                _md-diff_fuzzy_files
            fi
            ;;
        gitref)
            local refs
            refs=(HEAD HEAD~1 HEAD~2 HEAD~3 main master)
            refs+=(\${(f)"$(git for-each-ref --format='%(refname:short)' 2>/dev/null)"})
            _describe -t refs 'git ref' refs
            ;;
    esac
}

_md-diff "$@"
`;

export const FISH_COMPLETION = `# Fish completion for md-diff
# Install: md-diff --completions fish > ~/.config/fish/completions/md-diff.fish

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
complete -c md-diff -l compare -x -a '(git branch -a 2>/dev/null | sed "s/^[* ]*//" | sed "s/remotes\\///" )' -d 'Compare working dir to branch'
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
        find . -maxdepth 3 -name '*.md' 2>/dev/null | sed 's|^\\./||'
    end
end

complete -c md-diff -n 'not string match -q -- "-*" (commandline -ct)' -a '(__md_diff_git_shortcuts)' -d 'Git shortcut'
complete -c md-diff -n 'not string match -q -- "@*" (commandline -ct); and not string match -q -- "-*" (commandline -ct)' -a '(__md-diff_fuzzy_files)' -d 'Markdown file'
`;

export type ShellType = "bash" | "zsh" | "fish";

export function getCompletion(shell: ShellType): string {
  switch (shell) {
    case "bash":
      return BASH_COMPLETION;
    case "zsh":
      return ZSH_COMPLETION;
    case "fish":
      return FISH_COMPLETION;
  }
}

export function isValidShell(shell: string): shell is ShellType {
  return shell === "bash" || shell === "zsh" || shell === "fish";
}

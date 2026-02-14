#!/bin/bash
# Bash completion for md-diff
# Install: eval "$(md-diff completions bash)" in ~/.bashrc

_md_diff_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

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
            local branches=$(git branch -a 2>/dev/null | sed 's/^[* ]*//' | sed 's/remotes\///')
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
            local pattern="${cur//[^a-zA-Z0-9_.\/-]/}"
            files=$(echo "$files" | grep -i "$pattern" 2>/dev/null)
        fi
        COMPREPLY=($(compgen -W "$files" -- ""))
        return 0
    fi

    # Fallback: git ls-files (respects .gitignore)
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local files=$(git ls-files '*.md' 2>/dev/null)
        if [[ -n "$cur" ]]; then
            local pattern="${cur//[^a-zA-Z0-9_.\/-]/}"
            files=$(echo "$files" | grep -i "$pattern" 2>/dev/null)
        fi
        COMPREPLY=($(compgen -W "$files" -- ""))
        return 0
    fi

    COMPREPLY=($(compgen -f -X '!*.md' -- "$cur"))
    COMPREPLY+=($(compgen -d -- "$cur"))
}

complete -F _md_diff_completions md-diff


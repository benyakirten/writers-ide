//! The deliberately small package-range grammar, separate from API majors.
use std::cmp::Ordering;

use semver::Version;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PackageVersionRequirement {
    Exact(Version),
    Comparisons(Vec<Comparison>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Comparison {
    operator: Operator,
    version: Version,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operator {
    Greater,
    GreaterEqual,
    Less,
    LessEqual,
}

impl PackageVersionRequirement {
    pub(crate) fn parse(input: &str) -> Result<Self, &'static str> {
        let tokens: Vec<_> = input.split_whitespace().collect();
        if tokens.is_empty() {
            return Err("expected exact SemVer or comparison range");
        }
        if tokens.len() == 1 {
            if let Ok(version) = Version::parse(tokens[0]) {
                return Ok(Self::Exact(version));
            }
        }
        let mut comparisons = Vec::with_capacity(tokens.len());
        for token in tokens {
            let (operator, text) = if let Some(text) = token.strip_prefix(">=") {
                (Operator::GreaterEqual, text)
            } else if let Some(text) = token.strip_prefix("<=") {
                (Operator::LessEqual, text)
            } else if let Some(text) = token.strip_prefix('>') {
                (Operator::Greater, text)
            } else if let Some(text) = token.strip_prefix('<') {
                (Operator::Less, text)
            } else {
                return Err("expected exact SemVer or >, >=, <, <= comparisons");
            };
            let version =
                Version::parse(text).map_err(|_| "expected complete SemVer after operator")?;
            comparisons.push(Comparison { operator, version });
        }
        Ok(Self::Comparisons(comparisons))
    }

    pub(crate) fn matches(&self, candidate: &Version) -> bool {
        match self {
            Self::Exact(version) => candidate.cmp_precedence(version) == Ordering::Equal,
            Self::Comparisons(comparisons) => {
                if !candidate.pre.is_empty() {
                    return false;
                }
                comparisons.iter().all(|comparison| {
                    let ordering = candidate.cmp_precedence(&comparison.version);
                    match comparison.operator {
                        Operator::Greater => ordering == Ordering::Greater,
                        Operator::GreaterEqual => ordering != Ordering::Less,
                        Operator::Less => ordering == Ordering::Less,
                        Operator::LessEqual => ordering != Ordering::Greater,
                    }
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches(requirement: &str, candidate: &str) -> bool {
        PackageVersionRequirement::parse(requirement)
            .unwrap()
            .matches(&Version::parse(candidate).unwrap())
    }

    #[test]
    fn exact_versions_do_not_imply_compatible_releases() {
        assert!(matches("1.2.3", "1.2.3"));
        assert!(!matches("1.2.3", "1.2.4"));
        assert!(matches("1.2.3+build.1", "1.2.3+different.2"));
        assert!(matches("1.2.3-beta.2+build", "1.2.3-beta.2+other"));
        assert!(!matches("1.2.3-beta.2", "1.2.3"));
        assert!(!matches("1.2.3", "1.2.3-beta.2"));
    }

    #[test]
    fn comparisons_are_conjoined_with_semver_precedence() {
        for (requirement, candidate, expected) in [
            (">=1.3.0 <2.0.0", "1.3.0", true),
            (">=1.3.0 <2.0.0", "1.9.0", true),
            (">=1.3.0 <2.0.0", "2.0.0", false),
            (">=1.3.0 <2.0.0", "1.2.9", false),
            (">1.0.0 <=2.0.0", "1.0.0", false),
            (">1.0.0 <=2.0.0", "2.0.0", true),
            (">=1.0.0", "9.0.0", true),
            ("<1.0.0", "0.9.0", true),
            (">=1.0.0+one <=1.0.0+two", "1.0.0+three", true),
            (">=2.0.0 <1.0.0", "1.5.0", false),
            ("\t>=1.0.0\n<2.0.0 ", "1.4.0", true),
        ] {
            assert_eq!(
                matches(requirement, candidate),
                expected,
                "{requirement}: {candidate}"
            );
        }
    }

    #[test]
    fn comparison_ranges_never_opt_into_prerelease_candidates() {
        for candidate in ["1.0.0-alpha", "1.5.0-beta.1", "2.0.0-rc.1"] {
            assert!(!matches(">=0.0.0 <3.0.0", candidate));
            assert!(!matches(">=1.0.0-alpha <3.0.0", candidate));
        }
        assert!(matches("1.5.0-beta.1", "1.5.0-beta.1"));
        assert!(!matches("1.5.0-beta.1", "1.5.0-beta.2"));
    }

    #[test]
    fn unsupported_range_syntax_is_rejected() {
        for requirement in [
            "",
            " ",
            "*",
            "1",
            "1.2",
            "1.2.x",
            "^1.2.3",
            "~1.2.3",
            "=1.2.3",
            "1.0.0 || 2.0.0",
            "1.0.0 - 2.0.0",
            ">= 1.0.0",
            "1.0.0 <2.0.0",
            ">=1.0.0, <2.0.0",
            ">=01.0.0",
            "v1.0.0",
            "1.0.0-01",
            "=>1.0.0",
        ] {
            assert!(
                PackageVersionRequirement::parse(requirement).is_err(),
                "{requirement}"
            );
        }
    }
}

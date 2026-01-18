use std::str::Chars;
use std::iter::Peekable;

pub fn enumerate(regex: &str) -> Vec<String> {
    let mut chars = regex.chars().peekable();
    expand_expr(&mut chars)
}

fn expand_expr(chars: &mut Peekable<Chars>) -> Vec<String> {
    let mut alternatives = Vec::new();
    let mut current_sequence = vec!["".to_string()];

    while let Some(&c) = chars.peek() {
        match c {
            ')' => break,
            '(' => {
                chars.next(); // skip (
                if chars.peek() == Some(&'?') {
                    chars.next(); // skip ?
                    if chars.peek() == Some(&':') {
                        chars.next(); // skip :
                    }
                }
                let nested = expand_expr(chars);
                if chars.peek() == Some(&')') {
                    chars.next(); // skip )
                }
                
                // Handle optional after group
                if chars.peek() == Some(&'?') {
                    chars.next();
                    let mut new_seq = Vec::new();
                    for s in &current_sequence {
                        for n in &nested {
                            new_seq.push(format!("{}{}", s, n));
                        }
                        new_seq.push(s.clone()); // empty branch
                    }
                    current_sequence = new_seq;
                } else {
                    let mut new_seq = Vec::new();
                    for s in &current_sequence {
                        for n in &nested {
                            new_seq.push(format!("{}{}", s, n));
                        }
                    }
                    current_sequence = new_seq;
                }
            }
            '[' => {
                chars.next(); // skip [
                let mut class_chars = Vec::new();
                while let Some(cc) = chars.next() {
                    if cc == ']' { break; }
                    class_chars.push(cc);
                }
                
                // Handle optional after class
                if chars.peek() == Some(&'?') {
                    chars.next();
                    let mut new_seq = Vec::new();
                    for s in &current_sequence {
                        for &cc in &class_chars {
                            new_seq.push(format!("{}{}", s, cc));
                        }
                        new_seq.push(s.clone());
                    }
                    current_sequence = new_seq;
                } else {
                    let mut new_seq = Vec::new();
                    for s in &current_sequence {
                        for &cc in &class_chars {
                            new_seq.push(format!("{}{}", s, cc));
                        }
                    }
                    current_sequence = new_seq;
                }
            }
            '|' => {
                alternatives.push(current_sequence);
                current_sequence = vec!["".to_string()];
                chars.next();
            }
            '\\' => {
                chars.next();
                if let Some(escaped) = chars.next() {
                    let next_s = escaped.to_string();
                    if chars.peek() == Some(&'?') {
                         chars.next();
                         let mut new_seq = Vec::new();
                         for s in &current_sequence {
                             new_seq.push(format!("{}{}", s, next_s));
                             new_seq.push(s.clone());
                         }
                         current_sequence = new_seq;
                    } else {
                        for s in &mut current_sequence {
                            s.push_str(&next_s);
                        }
                    }
                }
            }
            _ => {
                let literal = chars.next().unwrap().to_string();
                if chars.peek() == Some(&'?') {
                    chars.next();
                    let mut new_seq = Vec::new();
                    for s in &current_sequence {
                        new_seq.push(format!("{}{}", s, literal));
                        new_seq.push(s.clone());
                    }
                    current_sequence = new_seq;
                } else {
                    for s in &mut current_sequence {
                        s.push_str(&literal);
                    }
                }
            }
        }
    }
    
    alternatives.push(current_sequence);
    alternatives.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple() {
        let res = enumerate("gi(?:é[cpt]|ế(?:p|ch))");
        assert!(res.contains(&"giéc".to_string()));
        assert!(res.contains(&"giép".to_string()));
        assert!(res.contains(&"giét".to_string()));
        assert!(res.contains(&"giếp".to_string()));
        assert!(res.contains(&"giếch".to_string()));
        assert_eq!(res.len(), 5);
    }
    
    #[test]
    fn test_optional() {
        let res = enumerate("a(?:b)?c");
        assert!(res.contains(&"abc".to_string()));
        assert!(res.contains(&"ac".to_string()));
        assert_eq!(res.len(), 2);
    }

    #[test]
    fn test_complex() {
        let res = enumerate("(?:ư(?:(?:ng?|[aimu]))?|u(?:(?:ng?|[aim]))?)");
        // ư, ưng, ưn, ưa, ưi, ưm, ưu, u, ung, un, ua, ui, um
        assert!(res.contains(&"ư".to_string()));
        assert!(res.contains(&"ưng".to_string()));
        assert!(res.contains(&"ưn".to_string()));
        assert!(res.contains(&"ua".to_string()));
        assert!(res.contains(&"u".to_string()));
    }
}

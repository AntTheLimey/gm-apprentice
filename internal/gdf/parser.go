package gdf

import (
	"bufio"
	"io"
	"strings"
)

// Section represents a GDF section like [ADVANTAGES]
type Section struct {
	Name    string
	Entries []Entry
}

// Entry represents a single item in a section
type Entry struct {
	Name       string
	Cost       string
	Fields     map[string]string
	Subsection string
	Raw        string
}

// Parse reads a GDF file and returns structured sections
func Parse(r io.Reader) ([]Section, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	var sections []Section
	currentIdx := -1
	currentSubsection := ""
	var lineBuf strings.Builder

	for scanner.Scan() {
		line := scanner.Text()

		// Skip empty lines
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Skip comments (lines starting with *)
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "*") {
			continue
		}

		// Skip header lines (double slashes)
		if strings.HasPrefix(trimmed, "//") {
			continue
		}

		// Section header
		if strings.HasPrefix(trimmed, "[") &&
			strings.HasSuffix(trimmed, "]") {
			name := trimmed[1 : len(trimmed)-1]
			sections = append(sections, Section{Name: name})
			currentIdx = len(sections) - 1
			currentSubsection = ""
			continue
		}

		// Subsection tag
		if strings.HasPrefix(trimmed, "<") &&
			strings.HasSuffix(trimmed, ">") {
			currentSubsection = trimmed[1 : len(trimmed)-1]
			continue
		}

		// Skip if no current section
		if currentIdx == -1 {
			continue
		}

		// Handle continuation lines:
		// A trailing _ signals explicit continuation.
		// A trailing , signals implicit continuation (next line
		// is part of the same entry).
		if strings.HasSuffix(trimmed, "_") {
			// Remove trailing _ and accumulate
			lineBuf.WriteString(
				strings.TrimSuffix(trimmed, "_"))
			lineBuf.WriteString(" ")
			continue
		}
		if strings.HasSuffix(trimmed, ",") {
			lineBuf.WriteString(trimmed)
			lineBuf.WriteString(" ")
			continue
		}

		// Complete line (possibly with accumulated buffer)
		fullLine := ""
		if lineBuf.Len() > 0 {
			lineBuf.WriteString(trimmed)
			fullLine = lineBuf.String()
			lineBuf.Reset()
		} else {
			fullLine = trimmed
		}

		entry := parseEntry(fullLine, currentSubsection)
		if entry.Name != "" {
			sections[currentIdx].Entries = append(sections[currentIdx].Entries, entry)
		}
	}

	return sections, scanner.Err()
}

func parseEntry(line string, subsection string) Entry {
	entry := Entry{
		Fields:     make(map[string]string),
		Subsection: subsection,
		Raw:        line,
	}

	// Parse the comma-separated fields
	// First field is the name, second is cost
	parts := splitRespectingParens(line)
	if len(parts) == 0 {
		return entry
	}

	entry.Name = strings.TrimSpace(parts[0])

	if len(parts) > 1 {
		entry.Cost = strings.TrimSpace(parts[1])
	}

	// Parse remaining fields as key(value) pairs
	for i := 2; i < len(parts); i++ {
		part := strings.TrimSpace(parts[i])
		if idx := strings.Index(part, "("); idx != -1 {
			key := part[:idx]
			// Find matching closing paren
			val := extractParenValue(part[idx:])
			entry.Fields[key] = val
		}
	}

	return entry
}

func splitRespectingParens(s string) []string {
	var parts []string
	depth := 0
	start := 0

	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	if start < len(s) {
		parts = append(parts, s[start:])
	}
	return parts
}

func extractParenValue(s string) string {
	if len(s) < 2 || s[0] != '(' {
		return s
	}
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return s[1:i]
			}
		}
	}
	// Unmatched paren — return everything after first (
	return s[1:]
}

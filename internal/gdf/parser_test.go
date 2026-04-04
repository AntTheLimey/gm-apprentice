package gdf

import (
	"os"
	"strings"
	"testing"
)

func TestParseSection(t *testing.T) {
	input := `[ADVANTAGES]
Combat Reflexes, 15, page(B43), cat(Mental, Physical),
    description(Never "freeze" in a surprise situation.)
High Pain Threshold, 10, page(B59), cat(Physical),
    description(You are as pointed as _
    you like.)
`
	sections, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(sections))
	}
	sec := sections[0]
	if sec.Name != "ADVANTAGES" {
		t.Errorf("expected section ADVANTAGES, got %s", sec.Name)
	}
	if len(sec.Entries) != 2 {
		t.Errorf("expected 2 entries, got %d", len(sec.Entries))
	}
	if sec.Entries[0].Name != "Combat Reflexes" {
		t.Errorf("expected Combat Reflexes, got %s",
			sec.Entries[0].Name)
	}
	if sec.Entries[0].Fields["page"] != "B43" {
		t.Errorf("expected page B43, got %s",
			sec.Entries[0].Fields["page"])
	}
}

func TestParseMultipleSections(t *testing.T) {
	input := `[ADVANTAGES]
Combat Reflexes, 15, page(B43)

[SKILLS]
Karate, DX/H, page(B203), cat(Combat)
`
	sections, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sections) != 2 {
		t.Fatalf("expected 2 sections, got %d", len(sections))
	}
	if sections[0].Name != "ADVANTAGES" {
		t.Errorf("expected ADVANTAGES, got %s", sections[0].Name)
	}
	if sections[1].Name != "SKILLS" {
		t.Errorf("expected SKILLS, got %s", sections[1].Name)
	}
}

func TestSkipComments(t *testing.T) {
	input := `[ADVANTAGES]
* This is a comment
Combat Reflexes, 15, page(B43)
`
	sections, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sections[0].Entries) != 1 {
		t.Errorf("expected 1 entry (comment skipped), got %d",
			len(sections[0].Entries))
	}
}

func TestContinuationLines(t *testing.T) {
	input := `[ADVANTAGES]
High Pain Threshold, 10, page(B59), _
    description(You are as tough as they come.)
`
	sections, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sections[0].Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d",
			len(sections[0].Entries))
	}
	if sections[0].Entries[0].Fields["description"] !=
		"You are as tough as they come." {
		t.Errorf("unexpected description: %s",
			sections[0].Entries[0].Fields["description"])
	}
}

func TestSubsections(t *testing.T) {
	input := `[ADVANTAGES]
<General>
Combat Reflexes, 15, page(B43)
<Mental>
Eidetic Memory, 5, page(B51)
`
	sections, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sections[0].Entries[0].Subsection != "General" {
		t.Errorf("expected General subsection, got %s",
			sections[0].Entries[0].Subsection)
	}
	if sections[0].Entries[1].Subsection != "Mental" {
		t.Errorf("expected Mental subsection, got %s",
			sections[0].Entries[1].Subsection)
	}
}

func TestRealFile(t *testing.T) {
	path := "/Users/antonypegg/Downloads/GCA4/data files/GURPS Basic Set 4th Ed.--Characters.gdf"
	f, err := os.Open(path)
	if err != nil {
		t.Skip("GCA data file not available:", err)
	}
	defer f.Close()

	sections, err := Parse(f)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}

	t.Logf("Parsed %d sections", len(sections))
	for _, s := range sections {
		t.Logf("  [%s]: %d entries", s.Name, len(s.Entries))
	}

	// Sanity checks
	if len(sections) < 5 {
		t.Error("expected at least 5 sections")
	}
}

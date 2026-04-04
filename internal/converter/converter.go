package converter

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/AntTheLimey/gm-apprentice/internal/gdf"
)

// ConvertSection writes a GDF section as a markdown file
func ConvertSection(section gdf.Section, outputDir string) error {
	filename := strings.ToLower(section.Name) + ".md"
	outPath := filepath.Join(outputDir, filename)

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	f, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	title := formatTitle(section.Name)
	fmt.Fprintf(f, "# %s\n\n", title)

	currentSub := ""
	for _, entry := range section.Entries {
		if entry.Subsection != currentSub {
			currentSub = entry.Subsection
			if currentSub != "" {
				fmt.Fprintf(f, "## %s\n\n", currentSub)
			}
		}
		writeEntry(f, entry)
	}

	return nil
}

// ConvertFile parses a GDF file and writes all sections
// as markdown files into a subdirectory named after the book
func ConvertFile(gdfPath string, outputDir string) error {
	f, err := os.Open(gdfPath)
	if err != nil {
		return fmt.Errorf("open gdf: %w", err)
	}
	defer f.Close()

	sections, err := gdf.Parse(f)
	if err != nil {
		return fmt.Errorf("parse gdf: %w", err)
	}

	// Create book subdirectory from filename
	base := filepath.Base(gdfPath)
	bookName := strings.TrimSuffix(base, filepath.Ext(base))
	bookName = sanitizeDirName(bookName)
	bookDir := filepath.Join(outputDir, bookName)

	for _, section := range sections {
		// Skip non-content sections
		if skipSection(section.Name) {
			continue
		}
		if len(section.Entries) == 0 {
			continue
		}
		if err := ConvertSection(section, bookDir); err != nil {
			return fmt.Errorf("convert %s: %w",
				section.Name, err)
		}
	}

	return nil
}

func writeEntry(w io.Writer, entry gdf.Entry) {
	fmt.Fprintf(w, "### %s\n", entry.Name)
	if entry.Cost != "" {
		fmt.Fprintf(w, "- **Cost:** %s\n", entry.Cost)
	}
	if page, ok := entry.Fields["page"]; ok {
		fmt.Fprintf(w, "- **Page:** %s\n", page)
	}
	if cat, ok := entry.Fields["cat"]; ok {
		fmt.Fprintf(w, "- **Category:** %s\n", cat)
	}
	if desc, ok := entry.Fields["description"]; ok && desc != "" {
		fmt.Fprintf(w, "\n%s\n", desc)
	}
	fmt.Fprintln(w)
}

func formatTitle(name string) string {
	if name == "" {
		return ""
	}
	lower := strings.ToLower(name)
	return strings.ToUpper(lower[:1]) + lower[1:]
}

func sanitizeDirName(name string) string {
	// Replace spaces and special chars with hyphens
	replacer := strings.NewReplacer(
		" ", "-",
		".", "",
		"'", "",
		",", "",
	)
	result := replacer.Replace(strings.ToLower(name))
	// Clean up double hyphens
	for strings.Contains(result, "--") {
		result = strings.ReplaceAll(result, "--", "-")
	}
	return result
}

var skipSections = map[string]bool{
	"AUTHOR":      true,
	"Settings":    true,
	"SKILLTYPES":  true,
	"CONVERTDICE": true,
	"BODY":        true,
}

func skipSection(name string) bool { return skipSections[name] }

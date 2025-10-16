# Story Retell Practice App

A web application for practicing story retelling skills, designed to help users improve their speaking and comprehension abilities through interactive audio-based exercises.

## Features

### Core Functionality
- **Audio Story Listening**: Stories are read aloud using Text-to-Speech (TTS)
- **Timed Practice Sessions**: 5-second preparation + 40-second speaking time
- **Real-time Speech Recognition**: Converts your speech to text automatically
- **Instant Feedback**: Get immediate scoring based on keyword matching
- **Multiple Difficulty Levels**: Easy, Medium, and Hard stories
- **Practice History**: Track your progress over time

### Enhanced Features
- **Web Speech API Integration**: Full W3C specification compliance
- **Smart Timing System**: Accurate phase transitions based on TTS completion
- **Audio Cues**: Beep sounds for start/end of speaking phases
- **Voice Customization**: Adjustable speech rate, volume, and voice selection
- **Keyword-based Scoring**: Uses predefined keywords from story data
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites
- Node.js 18+ 
- Modern browser with Web Speech API support (Chrome, Edge recommended)
- Microphone access for speech recognition

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/Story-Retell.git
   cd Story-Retell
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:3000`

## How to Use

### Practice Flow
1. **Start Practice**: Click "Start Practice" or press Space
2. **Listen**: Story is read aloud (no text displayed)
3. **Prepare**: 5-second countdown to organize your thoughts
4. **Speak**: Retell the story when you hear the beep (40 seconds)
5. **Get Feedback**: Instant scoring and keyword analysis

### Keyboard Shortcuts
- `Space` - Start practice
- `Escape` - Cancel current session
- `S` - Skip audio during listening phase
- `R` - Retry same story (from results)
- `N` - New story (from results)

### Voice Settings
- **Speech Rate**: Adjust how fast stories are read (0.5x - 1.5x)
- **Volume**: Control TTS volume (10% - 100%)
- **Voice Selection**: Choose from available system voices

## Technical Architecture

### Tech Stack
- **Frontend**: Next.js 14, React, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **Speech APIs**: Web Speech API (TTS & STT)
- **Audio**: Web Audio API for beep sounds

### Key Components
- `components/story-retell-app.tsx` - Main application component
- `lib/scoring.ts` - Keyword matching and scoring algorithms
- `public/data/stories.json` - Story data with predefined keywords

### Web Speech API Implementation
- **Speech Synthesis**: Enhanced TTS with proper event handling
- **Speech Recognition**: Continuous recognition with interim results
- **Error Handling**: Comprehensive error management for all API failures
- **Voice Selection**: Smart voice picking with user preferences

## Scoring System

### Keyword Matching
- Uses predefined keywords from `stories.json`
- Matches exact and partial keyword matches
- Focuses on meaningful content words (excludes stopwords)
- Provides detailed feedback on matched/missing keywords

### Score Calculation
- **Exact Matches**: 70% weight
- **Partial Matches**: 20% weight  
- **Content Word Overlap**: 10% weight
- **Length Bonus**: Additional points for substantial responses

## Project Structure

```
Story-Retell/
├── app/                    # Next.js app directory
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── story-retell/      # Story retell page
├── components/            # React components
│   ├── story-retell-app.tsx  # Main app component
│   └── ui/               # Reusable UI components
├── lib/                   # Utility libraries
│   ├── scoring.ts        # Scoring algorithms
│   └── utils.ts          # General utilities
├── public/               # Static assets
│   └── data/
│       └── stories.json  # Story data with keywords
├── styles/               # Global styles
└── docs/                 # Documentation
    └── webSpeechAPI_doc.txt
```

## UI Components

Built with shadcn/ui components:
- Cards for content organization
- Progress bars for timing
- Badges for status indicators
- Buttons with proper states
- Responsive grid layouts

## Configuration

### Environment Variables
No environment variables required for basic functionality.

### Browser Compatibility
- **Chrome**: Full support
- **Edge**: Full support
- **Firefox**: Limited TTS support
- **Safari**: Limited support

### Story Data Format
```json
{
  "stories": [
    {
      "id": 1,
      "text": "Story content...",
      "difficulty": "easy|medium|hard",
      "wordCount": 54,
      "keyWords": ["keyword1", "keyword2", "..."]
    }
  ]
}
```

## Troubleshooting

### Common Issues

**Speech Recognition Not Working**
- Ensure microphone permissions are granted
- Use Chrome or Edge browser
- Check microphone is not muted

**TTS Not Playing**
- Verify browser supports speech synthesis
- Check system audio settings
- Try different voice selection

**Low Accuracy Scores**
- Speak clearly and at normal pace
- Focus on key story elements
- Practice with easier difficulty first

## Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style
- Use TypeScript for type safety
- Follow React best practices
- Maintain component modularity
- Add proper error handling

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- Web Speech API documentation and examples
- shadcn/ui component library
- Next.js framework and community
- Contributors and testers

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check existing documentation
- Review browser compatibility requirements

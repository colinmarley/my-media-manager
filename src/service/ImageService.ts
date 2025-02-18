import axios from 'axios';

class ImageService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = 'http://localhost:8082';
  }

  async searchImages(query: string): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { query },
      });
      return response.data.matching_files;
    } catch (error) {
      console.error('Error searching images:', error);
      throw error;
    }
  }

  async listImages(): Promise<string> {
    try {
      const response = await axios.get(`${this.baseUrl}/list`, {
        responseType: 'text',
      });
      return response.data;
    } catch (error) {
      console.error('Error listing images:', error);
      throw error;
    }
  }

  async renameImage(currentName: string, newName: string, subfolder?: string): Promise<string> {
    try {
      const response = await axios.post(`${this.baseUrl}/rename`, null, {
        params: { current_name: currentName, new_name: newName, subfolder },
      });
      return response.data.message;
    } catch (error) {
      console.error('Error renaming image:', error);
      throw error;
    }
  }
}

export default ImageService;
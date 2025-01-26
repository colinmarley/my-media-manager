import React from 'react';
import MediaInformation from './_components/MediaInformation';
import { OmdbResponseFull } from '@/types/OmdbResponse.type';

//For testing purposes
import { sampleOmdbResponseData } from './test/sampleOmdbResponseFull';


interface MediaInformationViewProps {
    
}

const MediaInformationView: React.FC<MediaInformationViewProps> = () => {
  return (
    <div className="media-info-view-wrapper">
      <MediaInformation data={sampleOmdbResponseData} />
    </div>
  );
};

export default MediaInformationView;